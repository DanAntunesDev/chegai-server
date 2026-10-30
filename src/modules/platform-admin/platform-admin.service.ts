import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import { SYSTEM_ROLES } from '../access/permissions';
import { recordAudit } from '../audit/audit';
import type { AuthContext } from '../auth/auth.types';
import { InvitationsService } from '../invitations/invitations.service';
import { resolveEntitlements } from '../plans/entitlements';
import { StorageService } from '../storage/storage.service';
import type {
  BrandingAsset,
  CreateTenantInput,
  InviteMemberInput,
  ListTenantsInput,
  UpdateBrandingInput,
  UpdatePlanInput,
  UpdateTenantInput,
} from './platform-admin.schemas';

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ASSET_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const ASSET_COLUMNS: Record<BrandingAsset, 'logoUrl' | 'logoDarkUrl' | 'iconUrl'> = {
  logo: 'logoUrl',
  'logo-dark': 'logoDarkUrl',
  icon: 'iconUrl',
};

const tenantDetailInclude = {
  plan: true,
  branding: true,
  _count: { select: { units: true, memberships: true } },
} satisfies Prisma.TenantInclude;

type TenantDetail = Prisma.TenantGetPayload<{ include: typeof tenantDetailInclude }>;

function toJsonInput(value: unknown) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly invitations: InvitationsService,
  ) {}

  listPlans() {
    return this.prisma.plan.findMany({ orderBy: { monthlyPriceCents: 'asc' } });
  }

  async updatePlan(actor: AuthContext, id: string, input: UpdatePlanInput) {
    return this.prisma.asSystem(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id } });
      if (!before) {
        throw AppError.notFound('PLAN_NOT_FOUND', 'Plan not found');
      }
      const after = await tx.plan.update({ where: { id }, data: input });
      await recordAudit(tx, {
        tenantId: null,
        actorUserId: actor.userId,
        action: 'plan.updated',
        entity: 'plan',
        entityId: id,
        before: { ...before },
        after: { ...after },
      });
      return after;
    });
  }

  listTenants(input: ListTenantsInput) {
    return this.prisma
      .asSystem((tx) =>
        tx.tenant.findMany({
          where: {
            deletedAt: null,
            status: input.status,
            OR: input.search
              ? [
                  { displayName: { contains: input.search, mode: 'insensitive' } },
                  { slug: { contains: input.search, mode: 'insensitive' } },
                  { email: { contains: input.search, mode: 'insensitive' } },
                ]
              : undefined,
          },
          include: tenantDetailInclude,
          orderBy: { createdAt: 'desc' },
        }),
      )
      .then((tenants) => tenants.map((tenant) => this.present(tenant)));
  }

  getTenant(id: string) {
    return this.prisma.asSystem(async (tx) => this.present(await this.findTenant(tx, id)));
  }

  async createTenant(actor: AuthContext, input: CreateTenantInput) {
    const { tenant, invitation } = await this.prisma
      .asSystem(async (tx) => {
        const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
        if (!plan || !plan.isActive) {
          throw AppError.badRequest('PLAN_NOT_FOUND', 'Plan not found or inactive');
        }

        const created = await tx.tenant.create({
          data: {
            slug: input.slug,
            legalName: input.legalName,
            displayName: input.displayName,
            document: input.document,
            email: input.email,
            phone: input.phone,
            timezone: input.timezone,
            status: input.status,
            trialEndsAt:
              input.status === 'TRIAL'
                ? new Date(Date.now() + input.trialDays * 24 * 60 * 60 * 1000)
                : null,
            planId: plan.id,
            branding: { create: {} },
            units: {
              create: {
                name: input.unit.name,
                slug: input.unit.slug,
                city: input.unit.city,
                state: input.unit.state,
                timezone: input.timezone,
              },
            },
            roles: {
              create: SYSTEM_ROLES.map((role) => ({
                key: role.key,
                name: role.name,
                isSystem: true,
                permissions: [...role.permissions],
              })),
            },
          },
          include: { roles: true },
        });

        const ownerRole = created.roles.find((role) => role.key === 'OWNER');
        if (!ownerRole) {
          throw new Error('Owner role was not created');
        }

        const createdInvitation = await this.invitations.create(tx, {
          tenantId: created.id,
          roleId: ownerRole.id,
          email: input.owner.email,
          name: input.owner.name,
          invitedById: actor.userId,
        });

        await recordAudit(tx, {
          tenantId: created.id,
          actorUserId: actor.userId,
          action: 'tenant.created',
          entity: 'tenant',
          entityId: created.id,
          after: { slug: created.slug, plan: plan.code, owner: input.owner.email },
        });

        return {
          tenant: this.present(await this.findTenant(tx, created.id)),
          invitation: createdInvitation,
        };
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw AppError.conflict('SLUG_TAKEN', 'This slug is already in use');
        }
        throw error;
      });

    await this.invitations.send(invitation);

    return {
      tenant,
      invitation: { id: invitation.id, email: invitation.email, link: invitation.link },
    };
  }

  async updateTenant(actor: AuthContext, id: string, input: UpdateTenantInput) {
    return this.prisma.asSystem(async (tx) => {
      const before = await this.findTenant(tx, id);
      const { planCode, featureOverrides, limitOverrides, trialEndsAt, ...rest } = input;

      let planId: string | undefined;
      if (planCode) {
        const plan = await tx.plan.findUnique({ where: { code: planCode } });
        if (!plan) {
          throw AppError.badRequest('PLAN_NOT_FOUND', 'Plan not found');
        }
        planId = plan.id;
      }

      await tx.tenant.update({
        where: { id },
        data: {
          ...rest,
          planId,
          trialEndsAt: trialEndsAt === undefined ? undefined : trialEndsAt && new Date(trialEndsAt),
          featureOverrides:
            featureOverrides === undefined ? undefined : toJsonInput(featureOverrides),
          limitOverrides: limitOverrides === undefined ? undefined : toJsonInput(limitOverrides),
        },
      });

      const after = await this.findTenant(tx, id);
      await recordAudit(tx, {
        tenantId: id,
        actorUserId: actor.userId,
        action: 'tenant.updated',
        entity: 'tenant',
        entityId: id,
        before: { status: before.status, plan: before.plan.code, displayName: before.displayName },
        after: { status: after.status, plan: after.plan.code, displayName: after.displayName },
      });

      return this.present(after);
    });
  }

  async updateBranding(actor: AuthContext, id: string, input: UpdateBrandingInput) {
    return this.prisma
      .asSystem(async (tx) => {
        await this.findTenant(tx, id);
        const branding = await tx.tenantBranding.upsert({
          where: { tenantId: id },
          update: input,
          create: { tenantId: id, ...input },
        });
        await recordAudit(tx, {
          tenantId: id,
          actorUserId: actor.userId,
          action: 'branding.updated',
          entity: 'tenant_branding',
          entityId: id,
          after: { ...input },
        });
        return branding;
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw AppError.conflict('DOMAIN_TAKEN', 'This domain is already linked to a barbershop');
        }
        throw error;
      });
  }

  async uploadBrandingAsset(
    actor: AuthContext,
    id: string,
    asset: BrandingAsset,
    file: UploadedImage | undefined,
  ) {
    if (!file) {
      throw AppError.badRequest('FILE_REQUIRED', 'Send the image in the "file" field');
    }
    const extension = ASSET_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw AppError.badRequest('UNSUPPORTED_FILE_TYPE', 'Use PNG, JPEG or WebP');
    }
    if (file.size > MAX_ASSET_BYTES) {
      throw AppError.badRequest('FILE_TOO_LARGE', 'Images must be up to 2 MB');
    }

    await this.prisma.asSystem((tx) => this.findTenant(tx, id));

    const stored = await this.storage.putPublic(
      `tenants/${id}/branding/${asset}-${randomUUID()}.${extension}`,
      file.buffer,
      file.mimetype,
    );

    const update: Record<string, string> = { [ASSET_COLUMNS[asset]]: stored.url };
    return this.updateBranding(actor, id, update);
  }

  async inviteMember(actor: AuthContext, id: string, input: InviteMemberInput) {
    const invitation = await this.prisma.asSystem(async (tx) => {
      await this.findTenant(tx, id);
      const role = await tx.role.findUniqueOrThrow({
        where: { tenantId_key: { tenantId: id, key: input.roleKey } },
      });
      return this.invitations.create(tx, {
        tenantId: id,
        roleId: role.id,
        email: input.email,
        name: input.name,
        invitedById: actor.userId,
      });
    });

    await this.invitations.send(invitation);

    return { id: invitation.id, email: invitation.email, link: invitation.link };
  }

  private async findTenant(tx: TransactionClient, id: string): Promise<TenantDetail> {
    const tenant = await tx.tenant.findFirst({
      where: { id, deletedAt: null },
      include: tenantDetailInclude,
    });
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND', 'Barbershop not found');
    }
    return tenant;
  }

  private present(tenant: TenantDetail) {
    const { _count, plan, ...rest } = tenant;
    return {
      ...rest,
      plan: { id: plan.id, code: plan.code, name: plan.name },
      unitsCount: _count.units,
      membersCount: _count.memberships,
      entitlements: resolveEntitlements(plan, tenant.featureOverrides, tenant.limitOverrides),
    };
  }
}
