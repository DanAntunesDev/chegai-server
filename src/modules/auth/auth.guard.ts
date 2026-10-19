import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../../common/errors/app-error';
import { IS_PUBLIC_KEY } from './auth.decorators';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw AppError.unauthorized('UNAUTHENTICATED', 'Authentication required');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      request.auth = {
        userId: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
        permissions: payload.perms,
        isPlatformAdmin: payload.adm,
        mfaVerified: payload.mfa,
      };
      return true;
    } catch {
      throw AppError.unauthorized('INVALID_TOKEN', 'Access token is invalid or expired');
    }
  }
}
