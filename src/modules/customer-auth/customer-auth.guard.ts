import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { type CustomerIdentity, CustomerTokenService } from './customer-token.service';

type CustomerRequest = Request & { customer?: CustomerIdentity };

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly tokens: CustomerTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw AppError.unauthorized('CUSTOMER_TOKEN_REQUIRED', 'Verify your phone first');
    }
    request.customer = await this.tokens.verify(token);
    return true;
  }
}

export const CurrentCustomer = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<CustomerRequest>();
  return request.customer as CustomerIdentity;
});
