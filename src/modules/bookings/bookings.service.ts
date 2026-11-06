import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isExclusionViolation } from '../../common/errors/prisma-errors';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { AvailabilityService } from '../availability/availability.service';
import { localDateOf } from '../availability/zoned-time';
import type { ConfirmBookingInput, CreateHoldInput } from './bookings.schemas';

export const HOLD_TTL_MS = 5 * 60 * 1000;

const bookingInclude = {
  items: { orderBy: { position: 'asc' as const } },
  staff: { select: { id: true, name: true, nickname: true } },
  customer: { select: { id: true, name: true, phone: true } },
};

export type BookingSourceValue = 'PANEL' | 'PUBLIC' | 'WHATSAPP';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  createHold(auth: TenantAuthContext, input: CreateHoldInput) {
    return this.hold(auth.tenantId, input, 'PANEL', (staffUserId) =>
      this.assertCanManage(auth, staffUserId),
    );
  }

  async hold(
    tenantId: string,
    input: CreateHoldInput,
    source: BookingSourceValue,
    authorize: (staffUserId: string | null) => void = () => undefined,
  ) {
    const now = new Date();
    const startsAt = new Date(input.startsAt);

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        await this.releaseExpiredHolds(tx, now);

        const unit = await tx.unit.findFirst({ where: { id: input.unitId, deletedAt: null } });
        if (!unit) {
          throw AppError.notFound('UNIT_NOT_FOUND', 'Unit not found');
        }

        const result = await this.availability.compute(tx, {
          unitId: input.unitId,
          date: localDateOf(startsAt, unit.timezone),
          serviceIds: input.serviceIds,
          staffId: input.staffId,
          now,
        });

        const slot = result.slots.find((item) => item.startsAt.getTime() === startsAt.getTime());
        const staffId = input.staffId ?? slot?.staffIds[0];
        const offer = staffId ? result.offers.get(staffId) : undefined;

        if (!slot || !staffId || !offer || !slot.staffIds.includes(staffId)) {
          throw AppError.conflict('SLOT_UNAVAILABLE', 'This time is not available');
        }

        const staff = await tx.staff.findUniqueOrThrow({ where: { id: staffId } });
        authorize(staff.userId);

        const endsAt = new Date(startsAt.getTime() + offer.durationMinutes * 60000);

        return tx.booking.create({
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
          },
          include: bookingInclude,
        });
      });
    } catch (error) {
      if (isExclusionViolation(error, 'bookings_no_overlap')) {
        throw AppError.conflict('SLOT_TAKEN', 'Someone just booked this time');
      }
      throw error;
    }
  }

  confirm(auth: TenantAuthContext, id: string, input: ConfirmBookingInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      this.assertCanManage(auth, booking.staff.userId);

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

      let customerId = input.customerId;
      if (customerId) {
        const exists = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
        if (!exists) {
          throw AppError.notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
        }
      } else if (input.customer) {
        const customer = await tx.customer.upsert({
          where: { tenantId_phone: { tenantId: auth.tenantId, phone: input.customer.phone } },
          update: { deletedAt: null },
          create: { tenantId: auth.tenantId, ...input.customer },
        });
        customerId = customer.id;
      }

      return tx.booking.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          holdExpiresAt: null,
          customerId,
          notes: input.notes,
          createdById: auth.userId,
        },
        include: bookingInclude,
      });
    });
  }

  get(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.find(tx, id);
      return booking;
    });
  }

  private releaseExpiredHolds(tx: TransactionClient, now: Date) {
    return tx.booking.updateMany({
      where: { status: 'HOLD', holdExpiresAt: { lte: now } },
      data: { status: 'CANCELED', canceledAt: now, cancelReason: 'HOLD_EXPIRED' },
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
