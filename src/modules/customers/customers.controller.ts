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
  type CreateCustomerInput,
  createCustomerSchema,
  type ListCustomersInput,
  listCustomersSchema,
  type UpdateCustomerInput,
  updateCustomerSchema,
} from './customers.schemas';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.view')
  list(
    @CurrentTenant() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(listCustomersSchema)) query: ListCustomersInput,
  ) {
    return this.customers.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  get(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(auth, id);
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(
    @CurrentTenant() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomerInput,
  ) {
    return this.customers.create(auth, body);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @CurrentTenant() auth: TenantAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerInput,
  ) {
    return this.customers.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('customers.manage')
  remove(@CurrentTenant() auth: TenantAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(auth, id);
  }
}
