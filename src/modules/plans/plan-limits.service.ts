import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { TransactionClient } from '../../prisma/prisma.service';
import { resolveEntitlements } from './entitlements';

export type LimitedResource = 'units' | 'barbers' | 'receptionists';

@Injectable()
export class PlanLimitsService {
  async assertCanAdd(tx: TransactionClient, tenantId: string, resource: LimitedResource) {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true },
    });
    const limit = resolveEntitlements(tenant.plan, tenant.featureOverrides, tenant.limitOverrides)
      .limits[resource];

    if (limit === null) {
      return;
    }

    const current =
      resource === 'units'
        ? await tx.unit.count({ where: { tenantId, isActive: true, deletedAt: null } })
        : await tx.staff.count({
            where: {
              tenantId,
              isActive: true,
              deletedAt: null,
              kind: resource === 'barbers' ? 'BARBER' : 'RECEPTIONIST',
            },
          });

    if (current >= limit) {
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        `Your plan allows up to ${limit} ${resource}`,
        HttpStatus.FORBIDDEN,
        { resource, limit, current },
      );
    }
  }
}
