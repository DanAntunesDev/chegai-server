import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { recordAudit } from '../audit/audit';
import type { TenantAuthContext } from '../auth/auth.types';
import { resolveEntitlements } from '../plans/entitlements';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  current(auth: TenantAuthContext) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        include: { branding: true, plan: true },
      });

      return {
        id: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        legalName: tenant.legalName,
        email: tenant.email,
        phone: tenant.phone,
        timezone: tenant.timezone,
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt,
        plan: { code: tenant.plan.code, name: tenant.plan.name },
        branding: tenant.branding,
        entitlements: resolveEntitlements(
          tenant.plan,
          tenant.featureOverrides,
          tenant.limitOverrides,
        ),
      };
    });
  }

  rename(auth: TenantAuthContext, displayName: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: auth.tenantId } });
      if (!branding?.allowOwnerRename) {
        throw AppError.forbidden('RENAME_NOT_ALLOWED', 'Renaming is disabled for this barbershop');
      }

      const before = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
      const tenant = await tx.tenant.update({
        where: { id: auth.tenantId },
        data: { displayName },
      });

      await recordAudit(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'tenant.renamed',
        entity: 'tenant',
        entityId: auth.tenantId,
        before: { displayName: before.displayName },
        after: { displayName },
      });

      return { id: tenant.id, displayName: tenant.displayName };
    });
  }
}
