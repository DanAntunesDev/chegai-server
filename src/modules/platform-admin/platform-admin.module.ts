import { Module } from '@nestjs/common';
import { AdminConsoleController } from './admin-console.controller';
import { AdminConsoleService } from './admin-console.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  controllers: [PlatformAdminController, AdminConsoleController],
  providers: [PlatformAdminService, AdminConsoleService],
})
export class PlatformAdminModule {}
