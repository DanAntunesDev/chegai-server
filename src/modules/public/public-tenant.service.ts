import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

const OPEN_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE'] as const;

@Injectable()
export class PublicTenantService {
  constructor(private readonly prisma: PrismaService) {}

  async bySlug(slug: string) {
    const tenant = await this.prisma.asSystem((tx) =>
      tx.tenant.findFirst({
        where: { slug, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        select: { id: true, slug: true, displayName: true, phone: true, timezone: true },
      }),
    );
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND', 'Barbershop not found');
    }
    return tenant;
  }

  profile(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [branding, units] = [
        await tx.tenantBranding.findUnique({ where: { tenantId } }),
        await tx.unit.findMany({
          where: { deletedAt: null, isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            phone: true,
            street: true,
            number: true,
            district: true,
            city: true,
            state: true,
            timezone: true,
          },
        }),
      ];
      return {
        branding: {
          logoUrl: branding?.logoUrl ?? null,
          logoDarkUrl: branding?.logoDarkUrl ?? null,
          iconUrl: branding?.iconUrl ?? null,
          primaryColor: branding?.primaryColor ?? '#D62839',
          secondaryColor: branding?.secondaryColor ?? '#1E4FD8',
          showPoweredBy: branding?.showPoweredBy ?? true,
        },
        units,
      };
    });
  }

  catalog(tenantId: string, unitId?: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const categories = await tx.serviceCategory.findMany({
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true },
      });
      const services = await tx.service.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          categoryId: true,
          name: true,
          description: true,
          priceCents: true,
          durationMinutes: true,
        },
      });
      const staff = await tx.staff.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          kind: { not: 'RECEPTIONIST' },
          units: unitId ? { some: { unitId } } : undefined,
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          nickname: true,
          photoUrl: true,
          units: { select: { unitId: true } },
          services: { select: { serviceId: true } },
        },
      });
      return {
        categories,
        services,
        staff: staff.map((member) => ({
          id: member.id,
          name: member.nickname ?? member.name,
          photoUrl: member.photoUrl,
          unitIds: member.units.map((unit) => unit.unitId),
          serviceIds: member.services.length
            ? member.services.map((item) => item.serviceId)
            : services.map((service) => service.id),
        })),
      };
    });
  }
}
