import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentAuth, PlatformAdminOnly } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import {
  type BrandingAsset,
  brandingAssetSchema,
  type CreateTenantInput,
  createTenantSchema,
  type InviteMemberInput,
  inviteMemberSchema,
  type ListTenantsInput,
  listTenantsSchema,
  type UpdateBrandingInput,
  updateBrandingSchema,
  type UpdatePlanInput,
  updatePlanSchema,
  type UpdateTenantInput,
  updateTenantSchema,
} from './platform-admin.schemas';
import { PlatformAdminService, type UploadedImage } from './platform-admin.service';

@Controller('admin')
@PlatformAdminOnly()
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get('plans')
  listPlans() {
    return this.admin.listPlans();
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
  ) {
    return this.admin.updatePlan(auth, id, body);
  }

  @Get('tenants')
  listTenants(@Query(new ZodValidationPipe(listTenantsSchema)) query: ListTenantsInput) {
    return this.admin.listTenants(query);
  }

  @Post('tenants')
  createTenant(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createTenantSchema)) body: CreateTenantInput,
  ) {
    return this.admin.createTenant(auth, body);
  }

  @Get('tenants/:id')
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getTenant(id);
  }

  @Patch('tenants/:id')
  updateTenant(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantInput,
  ) {
    return this.admin.updateTenant(auth, id, body);
  }

  @Put('tenants/:id/branding')
  updateBranding(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBrandingSchema)) body: UpdateBrandingInput,
  ) {
    return this.admin.updateBranding(auth, id, body);
  }

  @Post('tenants/:id/branding/:asset')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadBrandingAsset(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('asset', new ZodValidationPipe(brandingAssetSchema)) asset: BrandingAsset,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.admin.uploadBrandingAsset(auth, id, asset, file);
  }

  @Post('tenants/:id/invitations')
  inviteMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberInput,
  ) {
    return this.admin.inviteMember(auth, id, body);
  }
}
