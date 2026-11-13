import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env';

export const CUSTOMER_TOKEN_TTL_SECONDS = 30 * 60;

export interface CustomerIdentity {
  tenantId: string;
  phone: string;
}

interface CustomerTokenPayload {
  sub: string;
  tid: string;
  typ: 'customer';
}

@Injectable()
export class CustomerTokenService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = createHmac('sha256', config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update('customer-token')
      .digest('base64url');
  }

  sign(identity: CustomerIdentity) {
    const payload: CustomerTokenPayload = {
      sub: identity.phone,
      tid: identity.tenantId,
      typ: 'customer',
    };
    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: CUSTOMER_TOKEN_TTL_SECONDS,
    });
  }

  async verify(token: string): Promise<CustomerIdentity> {
    try {
      const payload = await this.jwt.verifyAsync<CustomerTokenPayload>(token, {
        secret: this.secret,
      });
      if (payload.typ !== 'customer') {
        throw new Error('wrong token type');
      }
      return { tenantId: payload.tid, phone: payload.sub };
    } catch {
      throw AppError.unauthorized('INVALID_CUSTOMER_TOKEN', 'Verify your phone again');
    }
  }
}
