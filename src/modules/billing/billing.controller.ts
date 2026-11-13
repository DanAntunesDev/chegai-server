import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  AllowWhenBlocked,
  CurrentTenant,
  PlatformAdminOnly,
  Public,
  RequirePermissions,
} from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type RunBillingInput,
  runBillingSchema,
  type StartSubscriptionInput,
  startSubscriptionSchema,
} from './billing.schemas';
import { BillingService, type WebhookPayload } from './billing.service';
import { PaymentGateway } from './payment-gateway';

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly gateway: PaymentGateway,
  ) {}

  @AllowWhenBlocked()
  @RequirePermissions('billing.view')
  @Get('tenant/billing')
  mine(@CurrentTenant() auth: TenantAuthContext) {
    return this.billing.summary(auth.tenantId);
  }

  @PlatformAdminOnly()
  @Post('admin/tenants/:id/subscription')
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(startSubscriptionSchema)) body: StartSubscriptionInput,
  ) {
    return this.billing.startSubscription(id, body);
  }

  @PlatformAdminOnly()
  @Get('admin/tenants/:id/billing')
  forTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.summary(id);
  }

  @PlatformAdminOnly()
  @Post('admin/billing/run')
  @HttpCode(200)
  run(@Body(new ZodValidationPipe(runBillingSchema)) body: RunBillingInput) {
    return this.billing.runDaily(body.today);
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/asaas')
  @HttpCode(200)
  async webhook(
    @Headers('asaas-access-token') token: string | undefined,
    @Body() body: WebhookPayload,
  ) {
    if (!this.gateway.verifyWebhook(token)) {
      throw AppError.unauthorized('INVALID_WEBHOOK_TOKEN', 'Invalid webhook token');
    }
    await this.billing.handleWebhook(body);
    return { received: true };
  }
}
