import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/auth.decorators';

const resolveSchema = z.object({ host: z.string().min(3).max(253) });
const searchSchema = z.object({ q: z.string().trim().min(3).max(60) });

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tenants/:slug/branding')
  async branding(@Param('slug') slug: string) {
    const tenant = await this.prisma.asSystem((tx) =>
      tx.tenant.findFirst({
        where: { slug, deletedAt: null, status: { not: 'CANCELED' } },
        include: { branding: true },
      }),
    );

    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND', 'Barbershop not found');
    }

    return {
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status,
      logoUrl: tenant.branding?.logoUrl ?? null,
      logoDarkUrl: tenant.branding?.logoDarkUrl ?? null,
      iconUrl: tenant.branding?.iconUrl ?? null,
      primaryColor: tenant.branding?.primaryColor ?? '#D62839',
      secondaryColor: tenant.branding?.secondaryColor ?? '#1E4FD8',
      showPoweredBy: tenant.branding?.showPoweredBy ?? true,
    };
  }

  @Get('tenants')
  async search(@Query(new ZodValidationPipe(searchSchema)) query: z.infer<typeof searchSchema>) {
    const tenants = await this.prisma.asSystem((tx) =>
      tx.tenant.findMany({
        where: {
          deletedAt: null,
          status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
          OR: [
            { displayName: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q.toLowerCase() } },
          ],
        },
        orderBy: { displayName: 'asc' },
        take: 6,
        select: {
          slug: true,
          displayName: true,
          branding: { select: { iconUrl: true, primaryColor: true } },
          units: {
            where: { deletedAt: null, isActive: true },
            select: { city: true, state: true },
            take: 1,
          },
        },
      }),
    );
    return tenants.map((tenant) => ({
      slug: tenant.slug,
      displayName: tenant.displayName,
      iconUrl: tenant.branding?.iconUrl ?? null,
      primaryColor: tenant.branding?.primaryColor ?? '#D62839',
      city: tenant.units[0]?.city ?? null,
      state: tenant.units[0]?.state ?? null,
    }));
  }

  @Get('resolve')
  async resolve(@Query(new ZodValidationPipe(resolveSchema)) query: z.infer<typeof resolveSchema>) {
    const branding = await this.prisma.asSystem((tx) =>
      tx.tenantBranding.findFirst({
        where: { customDomain: query.host.toLowerCase(), tenant: { deletedAt: null } },
        include: { tenant: { select: { slug: true } } },
      }),
    );

    if (!branding) {
      throw AppError.notFound('DOMAIN_NOT_FOUND', 'No barbershop uses this domain');
    }

    return { slug: branding.tenant.slug };
  }
}
