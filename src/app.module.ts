import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CryptoModule } from './common/crypto/crypto.module';
import { type Env, validateEnv } from './config/env';
import { buildLoggerOptions } from './config/logger';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MailModule } from './modules/mail/mail.module';
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
    PrismaModule,
    CryptoModule,
    StorageModule,
    MailModule,
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
    HealthModule,
  ],
})
export class AppModule {}
