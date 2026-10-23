import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { AppError } from '../../common/errors/app-error';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { AcceptInvitationInput, LoginInput } from './auth.schemas';
import type { AccessTokenPayload, AuthContext, RequestMeta } from './auth.types';
import { hashToken, TokenService } from './token.service';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from './totp';

export interface SessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  tenant: { id: string; slug: string; displayName: string } | null;
  tenants: { id: string; slug: string; displayName: string; role: string }[];
}

type RefreshOutcome =
  | { kind: 'error'; code: 'INVALID_REFRESH_TOKEN' | 'REFRESH_TOKEN_REUSED' }
  | { kind: 'session'; session: SessionResult };

const DUMMY_HASH_PROMISE = hash('chegai-timing-protection');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly encryption: EncryptionService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<SessionResult> {
    return this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findFirst({ where: { email: input.email, deletedAt: null } });
      const passwordMatches = await verify(
        user?.passwordHash ?? (await DUMMY_HASH_PROMISE),
        input.password,
      );

      if (!user || !passwordMatches) {
        throw AppError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
      }

      let mfaVerified = false;
      if (user.totpEnabledAt && user.totpSecret) {
        if (!input.totpCode) {
          throw AppError.unauthorized('TOTP_REQUIRED', 'Two-factor code required');
        }
        if (!verifyTotp(this.encryption.decrypt(user.totpSecret), input.totpCode)) {
          throw AppError.unauthorized('INVALID_TOTP', 'Invalid two-factor code');
        }
        mfaVerified = true;
      }

      const memberships = await this.activeMemberships(tx, user.id);
      const membership = input.tenantSlug
        ? memberships.find((item) => item.tenant.slug === input.tenantSlug)
        : memberships[0];

      if (input.tenantSlug && !membership) {
        throw AppError.forbidden('TENANT_ACCESS_DENIED', 'No access to this barbershop');
      }

      if (!membership && !user.isPlatformAdmin) {
        throw AppError.forbidden('NO_ACTIVE_MEMBERSHIP', 'User has no active barbershop');
      }

      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      return this.createSession(tx, {
        user,
        tenantId: membership?.tenantId ?? null,
        mfaVerified,
        meta,
      });
    });
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<SessionResult> {
    if (!rawToken) {
      throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Refresh token missing');
    }

    const outcome = await this.prisma.asSystem<RefreshOutcome>(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { user: true },
      });

      if (!current) {
        return { kind: 'error', code: 'INVALID_REFRESH_TOKEN' };
      }

      if (current.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { kind: 'error', code: 'REFRESH_TOKEN_REUSED' };
      }

      if (current.expiresAt <= new Date() || current.user.deletedAt) {
        return { kind: 'error', code: 'INVALID_REFRESH_TOKEN' };
      }

      const session = await this.createSession(tx, {
        user: current.user,
        tenantId: current.tenantId,
        mfaVerified: Boolean(current.user.totpEnabledAt),
        familyId: current.familyId,
        meta,
      });

      await tx.refreshToken.update({
        where: { id: current.id },
        data: { revokedAt: new Date(), replacedById: session.refreshTokenId },
      });

      return { kind: 'session', session };
    });

    if (outcome.kind === 'error') {
      throw AppError.unauthorized(outcome.code, 'Refresh token is invalid, expired or reused');
    }

    return outcome.session;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }

    await this.prisma.asSystem(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      if (current) {
        await tx.refreshToken.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
  }

  async switchTenant(auth: AuthContext, tenantSlug: string, meta: RequestMeta) {
    return this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      const memberships = await this.activeMemberships(tx, user.id);
      const membership = memberships.find((item) => item.tenant.slug === tenantSlug);

      if (!membership) {
        throw AppError.forbidden('TENANT_ACCESS_DENIED', 'No access to this barbershop');
      }

      return this.createSession(tx, {
        user,
        tenantId: membership.tenantId,
        mfaVerified: auth.mfaVerified,
        meta,
      });
    });
  }

  async me(auth: AuthContext) {
    return this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, isPlatformAdmin: true, totpEnabledAt: true },
      });
      const memberships = await this.activeMemberships(tx, auth.userId);
      const current = memberships.find((item) => item.tenantId === auth.tenantId);

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          isPlatformAdmin: user.isPlatformAdmin,
          twoFactorEnabled: Boolean(user.totpEnabledAt),
        },
        tenant: current
          ? {
              id: current.tenant.id,
              slug: current.tenant.slug,
              displayName: current.tenant.displayName,
            }
          : null,
        role: auth.role,
        permissions: auth.permissions,
        tenants: memberships.map((item) => ({
          id: item.tenant.id,
          slug: item.tenant.slug,
          displayName: item.tenant.displayName,
          role: item.role.key,
        })),
      };
    });
  }

  async setupTotp(auth: AuthContext) {
    return this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      if (user.totpEnabledAt) {
        throw AppError.conflict('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already on');
      }

      const secret = generateTotpSecret();
      await tx.user.update({
        where: { id: user.id },
        data: { totpSecret: this.encryption.encrypt(secret) },
      });

      return { secret, otpauthUrl: buildOtpAuthUrl(secret, user.email) };
    });
  }

  async enableTotp(auth: AuthContext, code: string, meta: RequestMeta): Promise<SessionResult> {
    return this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      if (user.totpEnabledAt) {
        throw AppError.conflict('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already on');
      }
      if (!user.totpSecret || !verifyTotp(this.encryption.decrypt(user.totpSecret), code)) {
        throw AppError.badRequest('INVALID_TOTP', 'Invalid two-factor code');
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: new Date() },
      });

      return this.createSession(tx, {
        user: updated,
        tenantId: auth.tenantId,
        mfaVerified: true,
        meta,
      });
    });
  }

  async previewInvitation(token: string) {
    return this.prisma.asSystem(async (tx) => {
      const invitation = await this.findOpenInvitation(tx, token);
      const existingUser = await tx.user.findFirst({
        where: { email: invitation.email, deletedAt: null },
        select: { id: true },
      });

      return {
        email: invitation.email,
        name: invitation.name,
        barbershop: invitation.tenant.displayName,
        role: invitation.role.name,
        expiresAt: invitation.expiresAt,
        userExists: Boolean(existingUser),
      };
    });
  }

  async acceptInvitation(input: AcceptInvitationInput, meta: RequestMeta): Promise<SessionResult> {
    return this.prisma.asSystem(async (tx) => {
      const invitation = await this.findOpenInvitation(tx, input.token);
      let user = await tx.user.findFirst({ where: { email: invitation.email, deletedAt: null } });

      if (user) {
        if (!(await verify(user.passwordHash, input.password))) {
          throw AppError.unauthorized(
            'INVALID_CREDENTIALS',
            'This email already has an account; use its current password',
          );
        }
      } else {
        const name = input.name ?? invitation.name;
        if (!name) {
          throw AppError.badRequest('NAME_REQUIRED', 'Name is required to create the account');
        }
        user = await tx.user.create({
          data: { email: invitation.email, name, passwordHash: await hash(input.password) },
        });
      }

      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } },
        update: { roleId: invitation.roleId, isActive: true },
        create: { tenantId: invitation.tenantId, userId: user.id, roleId: invitation.roleId },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      return this.createSession(tx, {
        user,
        tenantId: invitation.tenantId,
        mfaVerified: false,
        meta,
      });
    });
  }

  private async findOpenInvitation(tx: TransactionClient, token: string) {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { tenant: true, role: true },
    });

    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.tenant.deletedAt
    ) {
      throw AppError.notFound('INVITATION_NOT_FOUND', 'Invitation is invalid, used or expired');
    }

    return invitation;
  }

  private activeMemberships(tx: TransactionClient, userId: string) {
    return tx.membership.findMany({
      where: { userId, isActive: true, tenant: { deletedAt: null } },
      include: { role: true, tenant: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async createSession(
    tx: TransactionClient,
    params: {
      user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
      tenantId: string | null;
      mfaVerified: boolean;
      familyId?: string;
      meta: RequestMeta;
    },
  ): Promise<SessionResult & { refreshTokenId: string }> {
    const memberships = await this.activeMemberships(tx, params.user.id);
    const membership = memberships.find((item) => item.tenantId === params.tenantId);

    if (params.tenantId && !membership) {
      throw AppError.forbidden('TENANT_ACCESS_DENIED', 'No access to this barbershop');
    }

    const payload: AccessTokenPayload = {
      sub: params.user.id,
      tid: membership?.tenantId ?? null,
      role: membership?.role.key ?? null,
      perms: membership?.role.permissions ?? [],
      adm: params.user.isPlatformAdmin,
      mfa: params.mfaVerified,
    };

    const refresh = await this.tokens.issueRefreshToken(tx, {
      userId: params.user.id,
      tenantId: payload.tid,
      familyId: params.familyId,
      meta: params.meta,
    });

    return {
      accessToken: await this.tokens.signAccessToken(payload),
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      refreshTokenId: refresh.id,
      user: {
        id: params.user.id,
        name: params.user.name,
        email: params.user.email,
        isPlatformAdmin: params.user.isPlatformAdmin,
      },
      tenant: membership
        ? {
            id: membership.tenant.id,
            slug: membership.tenant.slug,
            displayName: membership.tenant.displayName,
          }
        : null,
      tenants: memberships.map((item) => ({
        id: item.tenant.id,
        slug: item.tenant.slug,
        displayName: item.tenant.displayName,
        role: item.role.key,
      })),
    };
  }
}
