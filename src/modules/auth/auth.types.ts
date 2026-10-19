import type { Request } from 'express';

export interface AccessTokenPayload {
  sub: string;
  tid: string | null;
  role: string | null;
  perms: string[];
  adm: boolean;
  mfa: boolean;
}

export interface AuthContext {
  userId: string;
  tenantId: string | null;
  role: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  mfaVerified: boolean;
}

export interface TenantAuthContext extends AuthContext {
  tenantId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
