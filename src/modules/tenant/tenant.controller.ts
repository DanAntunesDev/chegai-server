import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant, RequirePermissions } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import { TenantService } from './tenant.service';

const renameSchema = z.object({ displayName: z.string().min(2).max(80) });

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  current(@CurrentTenant() auth: TenantAuthContext) {
    return this.tenant.current(auth);
  }

  @Patch()
  @RequirePermissions('tenant.settings.manage')
  rename(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(renameSchema)) body: z.infer<typeof renameSchema>,
  ) {
    return this.tenant.rename(auth, body.displayName);
  }
}
