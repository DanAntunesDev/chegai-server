import { Global, Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { TenantSettingsService } from './tenant-settings.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

@Global()
@Module({
  providers: [PlatformSettingsService, TenantSettingsService, WebhookDispatcher],
  exports: [PlatformSettingsService, TenantSettingsService, WebhookDispatcher],
})
export class IntegrationsModule {}
