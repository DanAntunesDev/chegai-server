import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { minutesToTime } from '../../common/validation/fields';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { type LimitedResource, PlanLimitsService } from '../plans/plan-limits.service';
import type {
  CreateBlockInput,
  CreateStaffInput,
  ListBlocksInput,
  ListStaffInput,
  StaffServicesInput,
  UpdateStaffInput,
  WorkingHoursInput,
} from './staff.schemas';
import { findOverlap } from './working-hours';

const LIMIT_BY_KIND: Partial<Record<string, LimitedResource>> = {
  BARBER: 'barbers',
  RECEPTIONIST: 'receptionists',
};

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
  ) {}

  list(auth: TenantAuthContext, input: ListStaffInput) {
    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.staff.findMany({
        where: {
          deletedAt: null,
          kind: input.kind,
          units: input.unitId ? { some: { unitId: input.unitId } } : undefined,
        },
        include: { units: { select: { unitId: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  get(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { id, deletedAt: null },
        include: {
          units: { select: { unitId: true } },
          workingHours: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
          services: { include: { service: { select: { id: true, name: true } } } },
        },
      });
      if (!staff) {
        throw AppError.notFound('STAFF_NOT_FOUND', 'Staff member not found');
      }

      return {
        ...staff,
        workingHours: staff.workingHours.map((interval) => ({
          id: interval.id,
          unitId: interval.unitId,
          weekday: interval.weekday,
          start: minutesToTime(interval.startMinute),
          end: minutesToTime(interval.endMinute),
        })),
      };
    });
  }

  create(auth: TenantAuthContext, input: CreateStaffInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const resource = LIMIT_BY_KIND[input.kind];
      if (resource) {
        await this.limits.assertCanAdd(tx, auth.tenantId, resource);
      }
      await this.assertUnits(tx, input.unitIds);

      const { unitIds, ...data } = input;
      return tx.staff.create({
        data: {
          ...data,
          tenantId: auth.tenantId,
          units: {
            create: unitIds.map((unitId) => ({ unitId, tenantId: auth.tenantId })),
          },
        },
        include: { units: { select: { unitId: true } } },
      });
    });
  }

  update(auth: TenantAuthContext, id: string, input: UpdateStaffInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const staff = await this.find(tx, id);
      const { unitIds, ...data } = input;

      if (input.isActive && !staff.isActive) {
        const resource = LIMIT_BY_KIND[staff.kind];
        if (resource) {
          await this.limits.assertCanAdd(tx, auth.tenantId, resource);
        }
      }

      if (unitIds) {
        await this.assertUnits(tx, unitIds);
        await tx.staffUnit.deleteMany({ where: { staffId: id } });
        await tx.staffUnit.createMany({
          data: unitIds.map((unitId) => ({ staffId: id, unitId, tenantId: auth.tenantId })),
        });
        await tx.workingHours.deleteMany({ where: { staffId: id, unitId: { notIn: unitIds } } });
      }

      return tx.staff.update({
        where: { id },
        data,
        include: { units: { select: { unitId: true } } },
      });
    });
  }

  remove(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.find(tx, id);
      await tx.staff.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
  }

  replaceWorkingHours(auth: TenantAuthContext, id: string, input: WorkingHoursInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const staff = await this.find(tx, id);
      const allowedUnits = new Set(staff.units.map((unit) => unit.unitId));
      const outside = input.intervals.find((interval) => !allowedUnits.has(interval.unitId));
      if (outside) {
        throw AppError.badRequest('UNIT_NOT_ASSIGNED', 'Staff member does not work at this unit', {
          unitId: outside.unitId,
        });
      }

      const overlap = findOverlap(input.intervals);
      if (overlap) {
        throw AppError.badRequest(
          'WORKING_HOURS_OVERLAP',
          'Working hours overlap on the same day',
          {
            weekday: overlap[0].weekday,
          },
        );
      }

      await tx.workingHours.deleteMany({ where: { staffId: id } });
      await tx.workingHours.createMany({
        data: input.intervals.map((interval) => ({
          tenantId: auth.tenantId,
          staffId: id,
          unitId: interval.unitId,
          weekday: interval.weekday,
          startMinute: interval.start,
          endMinute: interval.end,
        })),
      });
    });
  }

  listBlocks(auth: TenantAuthContext, id: string, input: ListBlocksInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.find(tx, id);
      return tx.scheduleBlock.findMany({
        where: {
          staffId: id,
          startsAt: { lt: new Date(input.to) },
          endsAt: { gt: new Date(input.from) },
        },
        orderBy: { startsAt: 'asc' },
      });
    });
  }

  createBlock(auth: TenantAuthContext, id: string, input: CreateBlockInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const staff = await this.find(tx, id);
      this.assertCanManageSchedule(auth, staff.userId);

      return tx.scheduleBlock.create({
        data: {
          tenantId: auth.tenantId,
          staffId: id,
          kind: input.kind,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          reason: input.reason,
        },
      });
    });
  }

  removeBlock(auth: TenantAuthContext, id: string, blockId: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const staff = await this.find(tx, id);
      this.assertCanManageSchedule(auth, staff.userId);
      const deleted = await tx.scheduleBlock.deleteMany({ where: { id: blockId, staffId: id } });
      if (deleted.count === 0) {
        throw AppError.notFound('BLOCK_NOT_FOUND', 'Schedule block not found');
      }
    });
  }

  replaceServices(auth: TenantAuthContext, id: string, input: StaffServicesInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.find(tx, id);
      const serviceIds = input.services.map((item) => item.serviceId);
      const found = await tx.service.count({ where: { id: { in: serviceIds }, deletedAt: null } });
      if (found !== new Set(serviceIds).size) {
        throw AppError.badRequest('SERVICE_NOT_FOUND', 'One or more services do not exist');
      }

      await tx.staffService.deleteMany({ where: { staffId: id } });
      await tx.staffService.createMany({
        data: input.services.map((item) => ({ ...item, staffId: id, tenantId: auth.tenantId })),
      });
    });
  }

  private assertCanManageSchedule(auth: TenantAuthContext, staffUserId: string | null) {
    const managesAll = auth.permissions.includes('staff.manage');
    const managesOwn =
      auth.permissions.includes('bookings.manage.own') && staffUserId === auth.userId;
    if (!managesAll && !managesOwn) {
      throw AppError.forbidden('PERMISSION_DENIED', 'You can only manage your own schedule');
    }
  }

  private async assertUnits(tx: TransactionClient, unitIds: string[]) {
    const found = await tx.unit.count({ where: { id: { in: unitIds }, deletedAt: null } });
    if (found !== new Set(unitIds).size) {
      throw AppError.badRequest('UNIT_NOT_FOUND', 'One or more units do not exist');
    }
  }

  private async find(tx: TransactionClient, id: string) {
    const staff = await tx.staff.findFirst({
      where: { id, deletedAt: null },
      include: { units: { select: { unitId: true } } },
    });
    if (!staff) {
      throw AppError.notFound('STAFF_NOT_FOUND', 'Staff member not found');
    }
    return staff;
  }
}
