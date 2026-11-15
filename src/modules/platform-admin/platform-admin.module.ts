import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AdminConsoleController } from './admin-console.controller';
import { AdminConsoleService } from './admin-console.service';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminIntegrationsService } from './admin-integrations.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [BillingModule],
  controllers: [PlatformAdminController, AdminConsoleController, AdminIntegrationsController],
  providers: [PlatformAdminService, AdminConsoleService, AdminIntegrationsService],
})
export class PlatformAdminModule {}
