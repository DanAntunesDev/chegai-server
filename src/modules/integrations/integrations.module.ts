import { Global, Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

@Global()
@Module({
  providers: [PlatformSettingsService, WebhookDispatcher],
  exports: [PlatformSettingsService, WebhookDispatcher],
})
export class IntegrationsModule {}
