export const PERMISSIONS = [
  'tenant.settings.manage',
  'roles.manage',
  'billing.view',
  'billing.manage',
  'units.manage',
  'staff.manage',
  'services.manage',
  'customers.view',
  'customers.manage',
  'bookings.view.own',
  'bookings.view.any',
  'bookings.manage.own',
  'bookings.manage.any',
  'analytics.view',
  'commissions.view.own',
  'commissions.view.any',
  'whatsapp.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey = 'OWNER' | 'MANAGER' | 'RECEPTIONIST' | 'BARBER';

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  permissions: readonly Permission[];
}

export const SYSTEM_ROLES: readonly SystemRole[] = [
  {
    key: 'OWNER',
    name: 'Dono',
    permissions: PERMISSIONS,
  },
  {
    key: 'MANAGER',
    name: 'Gerente',
    permissions: PERMISSIONS.filter(
      (permission) => !['billing.manage', 'roles.manage'].includes(permission),
    ),
  },
  {
    key: 'RECEPTIONIST',
    name: 'Recepcionista',
    permissions: ['customers.view', 'customers.manage', 'bookings.view.any', 'bookings.manage.any'],
  },
  {
    key: 'BARBER',
    name: 'Barbeiro',
    permissions: [
      'customers.view',
      'bookings.view.own',
      'bookings.manage.own',
      'commissions.view.own',
    ],
  },
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
