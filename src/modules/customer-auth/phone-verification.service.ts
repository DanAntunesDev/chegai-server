import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerMessenger } from '../messaging/customer-messenger';
import { CUSTOMER_TOKEN_TTL_SECONDS, CustomerTokenService } from './customer-token.service';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class PhoneVerificationService {
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: CustomerMessenger,
    private readonly tokens: CustomerTokenService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  async request(tenant: { id: string; displayName: string }, phone: string) {
    const now = new Date();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.prisma.withTenant(tenant.id, async (tx) => {
      const recent = await tx.phoneVerification.count({
        where: { phone, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
      });
      if (recent >= MAX_CODES_PER_WINDOW) {
        throw new AppError(
          'TOO_MANY_CODES',
          'Too many codes requested, wait a few minutes',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await tx.phoneVerification.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.phoneVerification.create({
        data: {
          tenantId: tenant.id,
          phone,
          codeHash: this.hash(tenant.id, phone, code),
          expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        },
      });
    });

    await this.messenger.sendVerificationCode({
      tenantId: tenant.id,
      tenantName: tenant.displayName,
      phone,
      code,
    });
    return { expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async verify(tenantId: string, phone: string, code: string) {
    const now = new Date();
    const matched = await this.prisma.withTenant(tenantId, async (tx) => {
      const pending = await tx.phoneVerification.findFirst({
        where: { phone, consumedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      if (!pending || pending.attempts >= MAX_ATTEMPTS) {
        return false;
      }
      const ok = this.matches(pending.codeHash, this.hash(tenantId, phone, code));
      await tx.phoneVerification.update({
        where: { id: pending.id },
        data: ok ? { consumedAt: now } : { attempts: { increment: 1 } },
      });
      return ok;
    });

    if (!matched) {
      throw AppError.badRequest('INVALID_CODE', 'The code is wrong or expired');
    }
    return {
      token: await this.tokens.sign({ tenantId, phone }),
      expiresInSeconds: CUSTOMER_TOKEN_TTL_SECONDS,
    };
  }

  private hash(tenantId: string, phone: string, code: string) {
    return createHmac('sha256', this.pepper).update(`${tenantId}:${phone}:${code}`).digest('hex');
  }

  private matches(expected: string, actual: string) {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(actual, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
