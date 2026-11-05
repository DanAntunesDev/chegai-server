import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { minutesToTime } from '../../common/validation/fields';
import type { TransactionClient } from '../../prisma/prisma.service';
import { computeSlots, type Slot, type StaffSchedule } from './slots';
import { addDays, localMinuteToInstant } from './zoned-time';

export interface AvailabilityRequest {
  unitId: string;
  date: string;
  serviceIds: string[];
  staffId?: string;
  now?: Date;
}

export interface PricedService {
  serviceId: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
  bufferMinutes: number;
}

export interface StaffOffer {
  staffId: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  items: PricedService[];
}

export interface AvailabilityResult {
  unit: { id: string; timezone: string };
  slots: Slot[];
  offers: Map<string, StaffOffer>;
}

@Injectable()
export class AvailabilityService {
  async compute(tx: TransactionClient, request: AvailabilityRequest): Promise<AvailabilityResult> {
    const now = request.now ?? new Date();
    const unit = await tx.unit.findFirst({
      where: { id: request.unitId, deletedAt: null, isActive: true },
    });
    if (!unit) {
      throw AppError.notFound('UNIT_NOT_FOUND', 'Unit not found');
    }

    const uniqueServiceIds = [...new Set(request.serviceIds)];
    const services = await tx.service.findMany({
      where: { id: { in: uniqueServiceIds }, deletedAt: null, isActive: true },
    });
    if (services.length !== uniqueServiceIds.length) {
      throw AppError.badRequest('SERVICE_NOT_FOUND', 'One or more services are unavailable');
    }

    const staffList = await tx.staff.findMany({
      where: {
        id: request.staffId,
        deletedAt: null,
        isActive: true,
        kind: { not: 'RECEPTIONIST' },
        units: { some: { unitId: unit.id } },
      },
      include: {
        workingHours: { where: { unitId: unit.id } },
        services: true,
      },
      orderBy: { name: 'asc' },
    });

    const dayStart = localMinuteToInstant(request.date, 0, unit.timezone);
    const dayEnd = localMinuteToInstant(addDays(request.date, 1), 0, unit.timezone);
    const staffIds = staffList.map((staff) => staff.id);

    const bookings = await tx.booking.findMany({
      where: {
        staffId: { in: staffIds },
        startsAt: { lt: dayEnd },
        blockedUntil: { gt: dayStart },
        OR: [
          { status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
          { status: 'HOLD', holdExpiresAt: { gt: now } },
        ],
      },
      select: { staffId: true, startsAt: true, blockedUntil: true },
    });
    const blocks = await tx.scheduleBlock.findMany({
      where: { staffId: { in: staffIds }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: { staffId: true, startsAt: true, endsAt: true },
    });

    const offers = new Map<string, StaffOffer>();
    const schedules: StaffSchedule[] = [];

    for (const staff of staffList) {
      const overrides = new Map(staff.services.map((item) => [item.serviceId, item]));
      const offersEverything = staff.services.length === 0;
      if (!offersEverything && !uniqueServiceIds.every((id) => overrides.has(id))) {
        continue;
      }

      const items = request.serviceIds.map((serviceId) => {
        const service = services.find((item) => item.id === serviceId);
        if (!service) {
          throw new Error(`Service ${serviceId} missing after validation`);
        }
        const override = overrides.get(serviceId);
        return {
          serviceId,
          name: service.name,
          priceCents: override?.priceCents ?? service.priceCents,
          durationMinutes: override?.durationMinutes ?? service.durationMinutes,
          bufferMinutes: service.bufferMinutes,
        };
      });

      const offer: StaffOffer = {
        staffId: staff.id,
        name: staff.nickname ?? staff.name,
        durationMinutes: items.reduce((sum, item) => sum + item.durationMinutes, 0),
        bufferMinutes: Math.max(...items.map((item) => item.bufferMinutes)),
        items,
      };
      offers.set(staff.id, offer);

      schedules.push({
        staffId: staff.id,
        durationMinutes: offer.durationMinutes,
        bufferMinutes: offer.bufferMinutes,
        workingIntervals: staff.workingHours,
        busy: [
          ...bookings
            .filter((booking) => booking.staffId === staff.id)
            .map((booking) => ({ start: booking.startsAt, end: booking.blockedUntil })),
          ...blocks
            .filter((block) => block.staffId === staff.id)
            .map((block) => ({ start: block.startsAt, end: block.endsAt })),
        ],
      });
    }

    const slots = computeSlots({
      date: request.date,
      timeZone: unit.timezone,
      slotIntervalMinutes: unit.slotIntervalMinutes,
      minAdvanceMinutes: unit.minAdvanceMinutes,
      maxAdvanceDays: unit.maxAdvanceDays,
      now,
      staff: schedules,
    });

    return { unit: { id: unit.id, timezone: unit.timezone }, slots, offers };
  }

  present(result: AvailabilityResult) {
    return {
      timezone: result.unit.timezone,
      slots: result.slots.map((slot) => ({
        time: minutesToTime(slot.minuteOfDay),
        startsAt: slot.startsAt.toISOString(),
        staff: slot.staffIds.map((staffId) => {
          const offer = result.offers.get(staffId);
          return {
            id: staffId,
            name: offer?.name ?? '',
            durationMinutes: offer?.durationMinutes ?? 0,
            priceCents: offer?.items.reduce((sum, item) => sum + item.priceCents, 0) ?? 0,
          };
        }),
      })),
    };
  }
}
