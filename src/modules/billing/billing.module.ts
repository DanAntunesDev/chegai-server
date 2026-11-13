import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AsaasGateway } from './asaas-gateway';
import { BillingController } from './billing.controller';
import { BillingScheduler } from './billing.scheduler';
import { BillingService } from './billing.service';
import { PaymentGateway } from './payment-gateway';
import { TenantBlockedGuard } from './tenant-blocked.guard';
import { TenantStatusCache } from './tenant-status.cache';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingScheduler,
    TenantStatusCache,
    { provide: PaymentGateway, useClass: AsaasGateway },
    { provide: APP_GUARD, useClass: TenantBlockedGuard },
  ],
  exports: [BillingService, PaymentGateway],
})
export class BillingModule {}
