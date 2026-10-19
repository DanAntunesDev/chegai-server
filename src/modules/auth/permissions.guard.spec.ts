import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_WITHOUT_MFA_KEY, PERMISSIONS_KEY, PLATFORM_ADMIN_KEY } from './auth.decorators';
import type { AuthContext } from './auth.types';
import { PermissionsGuard } from './permissions.guard';

function contextFor(auth: AuthContext): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

function guardWith(metadata: Record<string, unknown>) {
  const reflector = {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

const barber: AuthContext = {
  userId: 'u1',
  tenantId: 't1',
  role: 'BARBER',
  permissions: ['bookings.view.own'],
  isPlatformAdmin: false,
  mfaVerified: false,
};

describe('PermissionsGuard', () => {
  it('lets through a user holding the permission', () => {
    const guard = guardWith({ [PERMISSIONS_KEY]: ['bookings.view.own'] });
    expect(guard.canActivate(contextFor(barber))).toBe(true);
  });

  it('blocks a user missing the permission', () => {
    const guard = guardWith({ [PERMISSIONS_KEY]: ['billing.manage'] });
    expect(() => guard.canActivate(contextFor(barber))).toThrow('Missing permission');
  });

  it('blocks platform routes for regular users', () => {
    const guard = guardWith({ [PLATFORM_ADMIN_KEY]: true });
    expect(() => guard.canActivate(contextFor(barber))).toThrow('platform admins');
  });

  it('requires mfa for platform admins unless the route allows it', () => {
    const admin = { ...barber, isPlatformAdmin: true, tenantId: null };
    expect(() => guardWith({ [PLATFORM_ADMIN_KEY]: true }).canActivate(contextFor(admin))).toThrow(
      'two-factor',
    );
    expect(
      guardWith({ [PLATFORM_ADMIN_KEY]: true, [ALLOW_WITHOUT_MFA_KEY]: true }).canActivate(
        contextFor(admin),
      ),
    ).toBe(true);
  });
});
