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
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentTenant, RequirePermissions } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  type CategoryInput,
  categorySchema,
  type CreateServiceInput,
  createServiceSchema,
  type ListServicesInput,
  listServicesSchema,
  type UpdateCategoryInput,
  updateCategorySchema,
  type UpdateServiceInput,
  updateServiceSchema,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('service-categories')
  listCategories(@CurrentTenant() auth: TenantAuthContext) {
    return this.catalog.listCategories(auth);
  }

  @Post('service-categories')
  @RequirePermissions('services.manage')
  createCategory(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(categorySchema)) body: CategoryInput,
  ) {
    return this.catalog.createCategory(auth, body);
  }

  @Patch('service-categories/:id')
  @RequirePermissions('services.manage')
  updateCategory(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.catalog.updateCategory(auth, id, body);
  }

  @Delete('service-categories/:id')
  @HttpCode(204)
  @RequirePermissions('services.manage')
  removeCategory(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeCategory(auth, id);
  }

  @Get('services')
  listServices(
    @CurrentTenant() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(listServicesSchema)) query: ListServicesInput,
  ) {
    return this.catalog.listServices(auth, query);
  }

  @Post('services')
  @RequirePermissions('services.manage')
  createService(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createServiceSchema)) body: CreateServiceInput,
  ) {
    return this.catalog.createService(auth, body);
  }

  @Patch('services/:id')
  @RequirePermissions('services.manage')
  updateService(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateServiceSchema)) body: UpdateServiceInput,
  ) {
    return this.catalog.updateService(auth, id, body);
  }

  @Delete('services/:id')
  @HttpCode(204)
  @RequirePermissions('services.manage')
  removeService(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeService(auth, id);
  }
}
