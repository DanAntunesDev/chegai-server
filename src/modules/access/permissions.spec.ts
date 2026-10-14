import { PERMISSIONS, SYSTEM_ROLES, isPermission } from './permissions';

describe('system roles', () => {
  it('gives the owner every permission', () => {
    const owner = SYSTEM_ROLES.find((role) => role.key === 'OWNER');
    expect(owner?.permissions).toEqual(PERMISSIONS);
  });

  it('keeps billing management away from managers', () => {
    const manager = SYSTEM_ROLES.find((role) => role.key === 'MANAGER');
    expect(manager?.permissions).not.toContain('billing.manage');
    expect(manager?.permissions).toContain('analytics.view');
  });

  it('only uses permissions from the catalog', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions.every(isPermission)).toBe(true);
    }
  });
});
