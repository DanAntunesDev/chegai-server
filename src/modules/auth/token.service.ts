import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import type { TransactionClient } from '../../prisma/prisma.service';
import type { AccessTokenPayload, RequestMeta } from './auth.types';

export interface IssuedRefreshToken {
  token: string;
  id: string;
  expiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get accessTokenTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get refreshTokenTtlMs(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: this.accessTokenTtlSeconds });
  }

  async issueRefreshToken(
    tx: TransactionClient,
    params: { userId: string; tenantId: string | null; familyId?: string; meta: RequestMeta },
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);

    const record = await tx.refreshToken.create({
      data: {
        userId: params.userId,
        tenantId: params.tenantId,
        familyId: params.familyId ?? randomUUID(),
        tokenHash: hashToken(token),
        expiresAt,
        ip: params.meta.ip,
        userAgent: params.meta.userAgent,
      },
    });

    return { token, id: record.id, expiresAt };
  }
}
