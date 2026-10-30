import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { PlanLimitsService } from '../plans/plan-limits.service';
import type { CreateUnitInput, UpdateUnitInput } from './units.schemas';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
  ) {}

  list(auth: TenantAuthContext) {
    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.unit.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    );
  }

  create(auth: TenantAuthContext, input: CreateUnitInput) {
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        await this.limits.assertCanAdd(tx, auth.tenantId, 'units');
        return tx.unit.create({ data: { ...input, tenantId: auth.tenantId } });
      })
      .catch(rethrowSlugConflict);
  }

  update(auth: TenantAuthContext, id: string, input: UpdateUnitInput) {
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        await this.find(tx, id);
        return tx.unit.update({ where: { id }, data: input });
      })
      .catch(rethrowSlugConflict);
  }

  remove(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.find(tx, id);
      const remaining = await tx.unit.count({ where: { deletedAt: null, id: { not: id } } });
      if (remaining === 0) {
        throw AppError.conflict('LAST_UNIT', 'A barbershop needs at least one unit');
      }
      await tx.unit.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
  }

  private async find(tx: TransactionClient, id: string) {
    const unit = await tx.unit.findFirst({ where: { id, deletedAt: null } });
    if (!unit) {
      throw AppError.notFound('UNIT_NOT_FOUND', 'Unit not found');
    }
    return unit;
  }
}

function rethrowSlugConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw AppError.conflict('SLUG_TAKEN', 'Another unit already uses this slug');
  }
  throw error;
}
