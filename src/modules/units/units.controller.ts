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
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant, RequirePermissions } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type CreateUnitInput,
  createUnitSchema,
  type UpdateUnitInput,
  updateUnitSchema,
} from './units.schemas';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  list(@CurrentTenant() auth: TenantAuthContext) {
    return this.units.list(auth);
  }

  @Post()
  @RequirePermissions('units.manage')
  create(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createUnitSchema)) body: CreateUnitInput,
  ) {
    return this.units.create(auth, body);
  }

  @Patch(':id')
  @RequirePermissions('units.manage')
  update(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) body: UpdateUnitInput,
  ) {
    return this.units.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('units.manage')
  remove(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.units.remove(auth, id);
  }
}
