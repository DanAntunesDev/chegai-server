import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { CryptoModule } from './common/crypto/crypto.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { type Env, validateEnv } from './config/env';
import { buildLoggerOptions } from './config/logger';
import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BillingModule } from './modules/billing/billing.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MailModule } from './modules/mail/mail.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PlansModule } from './modules/plans/plans.module';
import { PublicModule } from './modules/public/public.module';
import { StaffModule } from './modules/staff/staff.module';
import { StorageModule } from './modules/storage/storage.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UnitsModule } from './modules/units/units.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => buildLoggerOptions(config),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: config.get('RATE_LIMIT_PER_MINUTE', { infer: true }),
          },
        ],
        skipIf: () => process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TESTS !== 'true',
      }),
    }),
    DiscoveryModule,
    PrismaModule,
    CryptoModule,
    IdempotencyModule,
    StorageModule,
    MailModule,
    MessagingModule,
    InvitationsModule,
    PlansModule,
    AuthModule,
    PlatformAdminModule,
    TenantModule,
    PublicModule,
    UnitsModule,
    StaffModule,
    CatalogModule,
    CustomersModule,
    AvailabilityModule,
    BookingsModule,
    BillingModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
