import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant, RequirePermissions } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type CreateBlockInput,
  createBlockSchema,
  type CreateStaffInput,
  createStaffSchema,
  type ListBlocksInput,
  listBlocksSchema,
  type ListStaffInput,
  listStaffSchema,
  type StaffServicesInput,
  staffServicesSchema,
  type UpdateStaffInput,
  updateStaffSchema,
  type WorkingHoursInput,
  workingHoursSchema,
} from './staff.schemas';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(
    @CurrentTenant() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(listStaffSchema)) query: ListStaffInput,
  ) {
    return this.staff.list(auth, query);
  }

  @Get(':id')
  get(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(auth, id);
  }

  @Post()
  @RequirePermissions('staff.manage')
  create(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createStaffSchema)) body: CreateStaffInput,
  ) {
    return this.staff.create(auth, body);
  }

  @Patch(':id')
  @RequirePermissions('staff.manage')
  update(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStaffSchema)) body: UpdateStaffInput,
  ) {
    return this.staff.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('staff.manage')
  remove(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.remove(auth, id);
  }

  @Put(':id/working-hours')
  @HttpCode(204)
  @RequirePermissions('staff.manage')
  replaceWorkingHours(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workingHoursSchema)) body: WorkingHoursInput,
  ) {
    return this.staff.replaceWorkingHours(auth, id, body);
  }

  @Put(':id/services')
  @HttpCode(204)
  @RequirePermissions('staff.manage')
  replaceServices(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(staffServicesSchema)) body: StaffServicesInput,
  ) {
    return this.staff.replaceServices(auth, id, body);
  }

  @Get(':id/blocks')
  listBlocks(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(listBlocksSchema)) query: ListBlocksInput,
  ) {
    return this.staff.listBlocks(auth, id, query);
  }

  @Post(':id/blocks')
  createBlock(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createBlockSchema)) body: CreateBlockInput,
  ) {
    return this.staff.createBlock(auth, id, body);
  }

  @Delete(':id/blocks/:blockId')
  @HttpCode(204)
  removeBlock(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ) {
    return this.staff.removeBlock(auth, id, blockId);
  }
}
