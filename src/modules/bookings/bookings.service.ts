import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isExclusionViolation } from '../../common/errors/prisma-errors';
import type { BookingStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { localDateOf } from '../availability/zoned-time';
import type {
  CancelBookingInput,
  ConfirmBookingInput,
  CreateHoldInput,
  ListBookingsQuery,
  RescheduleBookingInput,
} from './bookings.schemas';

export const HOLD_TTL_MS = 5 * 60 * 1000;
export const CHECK_IN_WINDOW_MS = 60 * 60 * 1000;

const bookingInclude = {
  items: { orderBy: { position: 'asc' as const } },
  staff: { select: { id: true, name: true, nickname: true } },
  customer: { select: { id: true, name: true, phone: true } },
};

export type BookingSourceValue = 'PANEL' | 'PUBLIC' | 'WHATSAPP';

interface TransitionInput {
  booking: { id: string; tenantId: string; status: BookingStatus };
  to: BookingStatus;
  actorUserId: string | null;
  data?: Prisma.BookingUncheckedUpdateManyInput;
  reason?: string;
  details?: Prisma.InputJsonValue;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  createHold(auth: TenantAuthContext, input: CreateHoldInput) {
    return this.hold(auth.tenantId, input, 'PANEL', auth.userId, (staffUserId) =>
      this.assertCanManage(auth, staffUserId),
    );
  }

  async hold(
    tenantId: string,
    input: CreateHoldInput,
    source: BookingSourceValue,
    actorUserId: string | null,
    authorize: (staffUserId: string | null) => void = () => undefined,
  ) {
    const now = new Date();
    const startsAt = new Date(input.startsAt);

    return this.mapOverlap(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        await this.releaseExpiredHolds(tx, now);

        const { staffId, offer } = await this.pickSlot(tx, {
          unitId: input.unitId,
          serviceIds: input.serviceIds,
          staffId: input.staffId,
          startsAt,
          now,
        });

        const staff = await tx.staff.findUniqueOrThrow({ where: { id: staffId } });
        authorize(staff.userId);

        const endsAt = new Date(startsAt.getTime() + offer.durationMinutes * 60000);
        const booking = await tx.booking.create({
          data: {
            tenantId,
            unitId: input.unitId,
            staffId,
            source,
            status: 'HOLD',
            startsAt,
            endsAt,
            blockedUntil: new Date(endsAt.getTime() + offer.bufferMinutes * 60000),
            holdExpiresAt: new Date(now.getTime() + HOLD_TTL_MS),
            totalPriceCents: offer.items.reduce((sum, item) => sum + item.priceCents, 0),
            createdById: actorUserId,
            items: {
              create: offer.items.map((item, position) => ({
                tenantId,
                serviceId: item.serviceId,
                name: item.name,
                priceCents: item.priceCents,
                durationMinutes: item.durationMinutes,
                position,
              })),
            },
            events: {
              create: { tenantId, toStatus: 'HOLD', actorUserId, data: { source } },
            },
          },
          include: bookingInclude,
        });
        return booking;
      }),
    );
  }

  confirm(auth: TenantAuthContext, id: string, input: ConfirmBookingInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanManage(auth, booking.staff.userId);
      this.assertHoldAlive(booking);

      const customerId = await this.resolveCustomer(tx, auth.tenantId, input);
      return this.transition(tx, {
        booking,
        to: 'CONFIRMED',
        actorUserId: auth.userId,
        data: { holdExpiresAt: null, customerId, notes: input.notes },
      });
    });
  }

  reschedule(auth: TenantAuthContext, id: string, input: RescheduleBookingInput) {
    const now = new Date();
    const startsAt = new Date(input.startsAt);

    return this.mapOverlap(() =>
      this.prisma.withTenant(auth.tenantId, async (tx) => {
        const booking = await this.find(tx, id);
        this.assertCanManage(auth, booking.staff.userId);
        if (booking.status !== 'CONFIRMED') {
          throw AppError.conflict(
            'BOOKING_NOT_RESCHEDULABLE',
            'Only confirmed bookings can be rescheduled',
          );
        }

        const { staffId, offer } = await this.pickSlot(tx, {
          unitId: booking.unitId,
          serviceIds: booking.items.map((item) => item.serviceId),
          staffId: input.staffId ?? booking.staffId,
          startsAt,
          now,
          excludeBookingId: booking.id,
        });

        if (staffId !== booking.staffId) {
          const target = await tx.staff.findUniqueOrThrow({ where: { id: staffId } });
          this.assertCanManage(auth, target.userId);
        }

        const endsAt = new Date(startsAt.getTime() + offer.durationMinutes * 60000);
        await tx.booking.update({
          where: { id },
          data: {
            staffId,
            startsAt,
            endsAt,
            blockedUntil: new Date(endsAt.getTime() + offer.bufferMinutes * 60000),
          },
        });
        await tx.bookingEvent.create({
          data: {
            tenantId: auth.tenantId,
            bookingId: id,
            fromStatus: 'CONFIRMED',
            toStatus: 'CONFIRMED',
            actorUserId: auth.userId,
            reason: 'RESCHEDULED',
            data: {
              from: { staffId: booking.staffId, startsAt: booking.startsAt.toISOString() },
              to: { staffId, startsAt: startsAt.toISOString() },
            },
          },
        });
        return this.load(tx, id);
      }),
    );
  }

  cancel(auth: TenantAuthContext, id: string, input: CancelBookingInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanManage(auth, booking.staff.userId);
      if (booking.status !== 'HOLD' && booking.status !== 'CONFIRMED') {
        throw AppError.conflict(
          'BOOKING_NOT_CANCELABLE',
          'Only held or confirmed bookings can be canceled',
        );
      }
      const now = new Date();
      return this.transition(tx, {
        booking,
        to: 'CANCELED',
        actorUserId: auth.userId,
        reason: input.reason,
        data: { canceledAt: now, cancelReason: input.reason ?? null, holdExpiresAt: null },
      });
    });
  }

  checkIn(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanManage(auth, booking.staff.userId);
      if (booking.status !== 'CONFIRMED') {
        throw AppError.conflict('BOOKING_NOT_CONFIRMED', 'Only confirmed bookings can check in');
      }
      const now = new Date();
      if (now.getTime() < booking.startsAt.getTime() - CHECK_IN_WINDOW_MS) {
        throw AppError.conflict('CHECK_IN_TOO_EARLY', 'Check-in opens one hour before the time');
      }
      return this.transition(tx, {
        booking,
        to: 'CHECKED_IN',
        actorUserId: auth.userId,
        data: { checkedInAt: now },
      });
    });
  }

  complete(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanManage(auth, booking.staff.userId);
      if (booking.status !== 'CHECKED_IN') {
        throw AppError.conflict('BOOKING_NOT_CHECKED_IN', 'Check in before completing');
      }
      return this.transition(tx, {
        booking,
        to: 'COMPLETED',
        actorUserId: auth.userId,
        data: { completedAt: new Date() },
      });
    });
  }

  markNoShow(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanManage(auth, booking.staff.userId);
      if (booking.status !== 'CONFIRMED') {
        throw AppError.conflict('BOOKING_NOT_CONFIRMED', 'Only confirmed bookings can be no-show');
      }
      if (booking.startsAt > new Date()) {
        throw AppError.conflict('BOOKING_NOT_STARTED', 'The booking time has not arrived yet');
      }
      return this.transition(tx, { booking, to: 'NO_SHOW', actorUserId: auth.userId });
    });
  }

  list(auth: TenantAuthContext, query: ListBookingsQuery) {
    const seesAll = auth.permissions.includes('bookings.view.any');
    if (!seesAll && !auth.permissions.includes('bookings.view.own')) {
      throw AppError.forbidden('PERMISSION_DENIED', 'You cannot view bookings');
    }

    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.booking.findMany({
        where: {
          unitId: query.unitId,
          staffId: query.staffId,
          staff: seesAll ? undefined : { userId: auth.userId },
          status: query.status?.length ? { in: query.status } : { not: 'HOLD' },
          startsAt: { gte: new Date(query.from), lt: new Date(query.to) },
        },
        include: bookingInclude,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 1000,
      }),
    );
  }

  get(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanView(auth, booking.staff.userId);
      const { staff, ...rest } = booking;
      return { ...rest, staff: { id: staff.id, name: staff.name, nickname: staff.nickname } };
    });
  }

  events(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanView(auth, booking.staff.userId);
      return tx.bookingEvent.findMany({
        where: { bookingId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  }

  async sweep(now = new Date()) {
    return this.prisma.asSystem(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string; tenant_id: string }[]>`
        UPDATE bookings
           SET status = 'CANCELED', canceled_at = ${now}, cancel_reason = 'HOLD_EXPIRED',
               hold_expires_at = NULL, updated_at = ${now}
         WHERE status = 'HOLD' AND hold_expires_at <= ${now}
     RETURNING id, tenant_id`;

      const missed = await tx.$queryRaw<{ id: string; tenant_id: string }[]>`
        UPDATE bookings AS b
           SET status = 'NO_SHOW', updated_at = ${now}
          FROM units AS u
         WHERE u.id = b.unit_id
           AND b.status = 'CONFIRMED'
           AND b.starts_at + make_interval(mins => u.no_show_after_minutes) <= ${now}
     RETURNING b.id, b.tenant_id`;

      await tx.bookingEvent.createMany({
        data: [
          ...expired.map((row) => ({
            tenantId: row.tenant_id,
            bookingId: row.id,
            fromStatus: 'HOLD' as const,
            toStatus: 'CANCELED' as const,
            reason: 'HOLD_EXPIRED',
          })),
          ...missed.map((row) => ({
            tenantId: row.tenant_id,
            bookingId: row.id,
            fromStatus: 'CONFIRMED' as const,
            toStatus: 'NO_SHOW' as const,
            reason: 'AUTOMATIC',
          })),
        ],
      });

      return { expiredHolds: expired.length, noShows: missed.length };
    });
  }

  private async pickSlot(
    tx: TransactionClient,
    request: {
      unitId: string;
      serviceIds: string[];
      staffId?: string;
      startsAt: Date;
      now: Date;
      excludeBookingId?: string;
    },
  ) {
    const unit = await tx.unit.findFirst({ where: { id: request.unitId, deletedAt: null } });
    if (!unit) {
      throw AppError.notFound('UNIT_NOT_FOUND', 'Unit not found');
    }

    const result = await this.availability.compute(tx, {
      unitId: request.unitId,
      date: localDateOf(request.startsAt, unit.timezone),
      serviceIds: request.serviceIds,
      staffId: request.staffId,
      excludeBookingId: request.excludeBookingId,
      now: request.now,
    });

    const slot = result.slots.find(
      (item) => item.startsAt.getTime() === request.startsAt.getTime(),
    );
    const staffId = request.staffId ?? slot?.staffIds[0];
    const offer = staffId ? result.offers.get(staffId) : undefined;

    if (!slot || !staffId || !offer || !slot.staffIds.includes(staffId)) {
      throw AppError.conflict('SLOT_UNAVAILABLE', 'This time is not available');
    }
    return { staffId, offer };
  }

  private async transition(tx: TransactionClient, input: TransitionInput) {
    const { booking, to } = input;
    const updated = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { ...input.data, status: to },
    });
    if (updated.count === 0) {
      throw AppError.conflict('BOOKING_CHANGED', 'The booking was changed, reload and try again');
    }
    await tx.bookingEvent.create({
      data: {
        tenantId: booking.tenantId,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: to,
        actorUserId: input.actorUserId,
        reason: input.reason,
        data: input.details,
      },
    });
    return this.load(tx, booking.id);
  }

  private async resolveCustomer(
    tx: TransactionClient,
    tenantId: string,
    input: ConfirmBookingInput,
  ) {
    if (input.customerId) {
      const exists = await tx.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
      });
      if (!exists) {
        throw AppError.notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
      }
      return input.customerId;
    }
    if (!input.customer) {
      return undefined;
    }
    const customer = await tx.customer.upsert({
      where: { tenantId_phone: { tenantId, phone: input.customer.phone } },
      update: { deletedAt: null },
      create: { tenantId, ...input.customer },
    });
    return customer.id;
  }

  private assertHoldAlive(booking: { status: BookingStatus; holdExpiresAt: Date | null }) {
    if (booking.status !== 'HOLD') {
      throw AppError.conflict('BOOKING_NOT_ON_HOLD', 'Only held bookings can be confirmed');
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
      throw new AppError(
        'HOLD_EXPIRED',
        'The reservation expired, pick the time again',
        HttpStatus.GONE,
      );
    }
  }

  private async mapOverlap<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isExclusionViolation(error, 'bookings_no_overlap')) {
        throw AppError.conflict('SLOT_TAKEN', 'Someone just booked this time');
      }
      throw error;
    }
  }

  private async releaseExpiredHolds(tx: TransactionClient, now: Date) {
    const expired = await tx.booking.findMany({
      where: { status: 'HOLD', holdExpiresAt: { lte: now } },
      select: { id: true, tenantId: true },
    });
    if (expired.length === 0) {
      return;
    }
    await tx.booking.updateMany({
      where: { id: { in: expired.map((row) => row.id) }, status: 'HOLD' },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        cancelReason: 'HOLD_EXPIRED',
        holdExpiresAt: null,
      },
    });
    await tx.bookingEvent.createMany({
      data: expired.map((row) => ({
        tenantId: row.tenantId,
        bookingId: row.id,
        fromStatus: 'HOLD' as const,
        toStatus: 'CANCELED' as const,
        reason: 'HOLD_EXPIRED',
      })),
    });
  }

  private assertCanManage(auth: TenantAuthContext, staffUserId: string | null) {
    if (auth.permissions.includes('bookings.manage.any')) {
      return;
    }
    if (auth.permissions.includes('bookings.manage.own') && staffUserId === auth.userId) {
      return;
    }
    throw AppError.forbidden('PERMISSION_DENIED', 'You cannot manage bookings for this barber');
  }

  private assertCanView(auth: TenantAuthContext, staffUserId: string | null) {
    if (
      auth.permissions.includes('bookings.view.any') ||
      auth.permissions.includes('bookings.manage.any')
    ) {
      return;
    }
    if (
      (auth.permissions.includes('bookings.view.own') ||
        auth.permissions.includes('bookings.manage.own')) &&
      staffUserId === auth.userId
    ) {
      return;
    }
    throw AppError.notFound('BOOKING_NOT_FOUND', 'Booking not found');
  }

  private load(tx: TransactionClient, id: string) {
    return tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
  }

  private async find(tx: TransactionClient, id: string) {
    const booking = await tx.booking.findUnique({
      where: { id },
      include: {
        ...bookingInclude,
        staff: { select: { id: true, name: true, nickname: true, userId: true } },
      },
    });
    if (!booking) {
      throw AppError.notFound('BOOKING_NOT_FOUND', 'Booking not found');
    }
    return booking;
  }
}
