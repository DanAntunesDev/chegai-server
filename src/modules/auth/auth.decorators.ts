import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Permission } from '../access/permissions';
import type { AuthContext, AuthenticatedRequest, TenantAuthContext } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';
export const PLATFORM_ADMIN_KEY = 'auth:platform-admin';
export const ALLOW_WITHOUT_MFA_KEY = 'auth:allow-without-mfa';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true);

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) {
    throw AppError.unauthorized('UNAUTHENTICATED', 'Authentication required');
  }
  return request.auth satisfies AuthContext;
});

export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth?.tenantId) {
    throw AppError.forbidden('TENANT_REQUIRED', 'This action requires a barbershop context');
  }
  return request.auth as TenantAuthContext;
});
