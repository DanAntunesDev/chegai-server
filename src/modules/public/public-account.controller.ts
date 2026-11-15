import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppError } from '../../common/errors/app-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Public } from '../auth/auth.decorators';
import {
  type ConfirmAccountInput,
  confirmAccountSchema,
  type LoginAccountInput,
  loginAccountSchema,
  type RegisterAccountInput,
  registerAccountSchema,
} from '../customer-auth/customer-account.schemas';
import { CustomerAccountService } from '../customer-auth/customer-account.service';
import { CurrentCustomer, CustomerAuthGuard } from '../customer-auth/customer-auth.guard';
import type { CustomerIdentity } from '../customer-auth/customer-token.service';
import { PublicTenantService } from './public-tenant.service';

@Public()
@Controller('public/tenants/:slug/accounts')
export class PublicAccountController {
  constructor(
    private readonly tenants: PublicTenantService,
    private readonly accounts: CustomerAccountService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(202)
  async register(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(registerAccountSchema)) body: RegisterAccountInput,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.accounts.register(tenant, body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(confirmAccountSchema)) body: ConfirmAccountInput,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.accounts.confirm(tenant.id, body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(loginAccountSchema)) body: LoginAccountInput,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    return this.accounts.login(tenant.id, body);
  }

  @UseGuards(CustomerAuthGuard)
  @Get('me')
  async me(@Param('slug') slug: string, @CurrentCustomer() customer: CustomerIdentity) {
    const tenant = await this.tenants.bySlug(slug);
    if (tenant.id !== customer.tenantId) {
      throw AppError.unauthorized('INVALID_CUSTOMER_TOKEN', 'Verify your phone again');
    }
    return this.accounts.me(tenant.id, customer.phone);
  }
}
