import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentTenant } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import { type AvailabilityQuery, availabilityQuerySchema } from './availability.schemas';
import { AvailabilityService } from './availability.service';

@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  async get(
    @CurrentTenant() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    const result = await this.prisma.withTenant(auth.tenantId, (tx) =>
      this.availability.compute(tx, query),
    );
    return { date: query.date, ...this.availability.present(result) };
  }
}
