import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/auth.decorators';
import {
  type AvailabilityQuery,
  availabilityQuerySchema,
} from '../availability/availability.schemas';
import { AvailabilityService } from '../availability/availability.service';
import { type CreateHoldInput, createHoldSchema } from '../bookings/bookings.schemas';
import { BookingsService } from '../bookings/bookings.service';
import { CurrentCustomer, CustomerAuthGuard } from '../customer-auth/customer-auth.guard';
import type { CustomerIdentity } from '../customer-auth/customer-token.service';
import { PhoneVerificationService } from '../customer-auth/phone-verification.service';
import { AppError } from '../../common/errors/app-error';
import {
  type PublicConfirmInput,
  publicConfirmSchema,
  type RequestCodeInput,
  requestCodeSchema,
  type VerifyCodeInput,
  verifyCodeSchema,
} from './public-booking.schemas';
import { PublicTenantService } from './public-tenant.service';

const catalogQuerySchema = z.object({ unitId: z.uuid().optional() });

@Public()
@Controller('public/tenants/:slug')
export class PublicBookingController {
  constructor(
    private readonly tenants: PublicTenantService,
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly bookings: BookingsService,
    private readonly verification: PhoneVerificationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  async profile(@Param('slug') slug: string) {
    const tenant = await this.tenants.bySlug(slug);
    return {
      slug: tenant.slug,
      displayName: tenant.displayName,
      phone: tenant.phone,
      ...(await this.tenants.profile(tenant.id)),
    };
  }

  @Get('catalog')
  async catalog(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(catalogQuerySchema)) query: z.infer<typeof catalogQuerySchema>,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.tenants.catalog(tenant.id, query.unitId);
  }

  @Get('availability')
  async availabilityFor(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    const result = await this.prisma.withTenant(tenant.id, (tx) =>
      this.availability.compute(tx, query),
    );
    return { date: query.date, ...this.availability.present(result) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verification/request')
  @HttpCode(202)
  async requestCode(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(requestCodeSchema)) body: RequestCodeInput,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.verification.request(tenant, body.phone);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verification/confirm')
  @HttpCode(200)
  async verifyCode(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(verifyCodeSchema)) body: VerifyCodeInput,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.verification.verify(tenant.id, body.phone, body.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('bookings/holds')
  async hold(
    @Param('slug') slug: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createHoldSchema)) body: CreateHoldInput,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.idempotency.run(
      { tenantId: tenant.id, key, scope: 'public.hold', payload: body },
      async () =>
        this.bookings.presentPublic(await this.bookings.hold(tenant.id, body, 'PUBLIC', null)),
    );
  }

  @UseGuards(CustomerAuthGuard)
  @Post('bookings/:id/confirm')
  @HttpCode(200)
  async confirm(
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCustomer() customer: CustomerIdentity,
    @Body(new ZodValidationPipe(publicConfirmSchema)) body: PublicConfirmInput,
  ) {
    const tenant = await this.ownTenant(slug, customer);
    return this.bookings.confirmPublic(tenant.id, id, { phone: customer.phone, ...body });
  }

  @UseGuards(CustomerAuthGuard)
  @Get('bookings')
  async mine(@Param('slug') slug: string, @CurrentCustomer() customer: CustomerIdentity) {
    const tenant = await this.ownTenant(slug, customer);
    return this.bookings.listForCustomer(tenant.id, customer.phone);
  }

  @UseGuards(CustomerAuthGuard)
  @Post('bookings/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCustomer() customer: CustomerIdentity,
  ) {
    const tenant = await this.ownTenant(slug, customer);
    return this.bookings.cancelByCustomer(tenant.id, id, customer.phone);
  }

  private async ownTenant(slug: string, customer: CustomerIdentity) {
    const tenant = await this.tenants.bySlug(slug);
    if (tenant.id !== customer.tenantId) {
      throw AppError.unauthorized('INVALID_CUSTOMER_TOKEN', 'Verify your phone again');
    }
    return tenant;
  }
}
