import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant, RequirePermissions } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type CreatePaymentLinkInput,
  createPaymentLinkSchema,
  type PaymentSettingsInput,
  paymentSettingsSchema,
} from './booking-payments.schemas';
import { BookingPaymentsService } from './booking-payments.service';

@Controller()
export class BookingPaymentsController {
  constructor(private readonly payments: BookingPaymentsService) {}

  @Get('bookings/:id/payments')
  list(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.list(auth, id);
  }

  @Post('bookings/:id/payment-link')
  createLink(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createPaymentLinkSchema)) body: CreatePaymentLinkInput,
  ) {
    return this.payments.createLink(auth, id, body);
  }

  @Get('payment-settings')
  settings(@CurrentTenant() auth: TenantAuthContext) {
    return this.payments.settings(auth.tenantId);
  }

  @Put('payment-settings')
  @RequirePermissions('tenant.settings.manage')
  updateSettings(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(paymentSettingsSchema)) body: PaymentSettingsInput,
  ) {
    return this.payments.updateSettings(auth.tenantId, body);
  }
}
