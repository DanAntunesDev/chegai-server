import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/errors/app-error';
import { ALLOW_WHEN_BLOCKED_KEY } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { TenantStatusCache } from './tenant-status.cache';

@Injectable()
export class TenantBlockedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly statuses: TenantStatusCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth?.tenantId || auth.isPlatformAdmin) {
      return true;
    }
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_BLOCKED_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const status = await this.statuses.get(auth.tenantId);
    if (status === 'BLOCKED' || status === 'CANCELED') {
      throw new AppError(
        'TENANT_BLOCKED',
        'Access is suspended until the pending invoice is paid',
        402,
      );
    }
    return true;
  }
}
