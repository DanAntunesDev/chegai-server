import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/errors/app-error';
import {
  ALLOW_WITHOUT_MFA_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PLATFORM_ADMIN_KEY,
} from './auth.decorators';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) {
      throw AppError.unauthorized('UNAUTHENTICATED', 'Authentication required');
    }

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets)) {
      if (!auth.isPlatformAdmin) {
        throw AppError.forbidden('PLATFORM_ADMIN_REQUIRED', 'Restricted to platform admins');
      }
      const allowWithoutMfa = this.reflector.getAllAndOverride<boolean>(
        ALLOW_WITHOUT_MFA_KEY,
        targets,
      );
      if (!auth.mfaVerified && !allowWithoutMfa) {
        throw AppError.forbidden('MFA_REQUIRED', 'Enable two-factor authentication first');
      }
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((permission) => !auth.permissions.includes(permission));

    if (missing.length > 0) {
      throw AppError.forbidden('PERMISSION_DENIED', `Missing permission: ${missing.join(', ')}`);
    }

    return true;
  }
}
