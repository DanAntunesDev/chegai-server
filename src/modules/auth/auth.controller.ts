import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { Env } from '../../config/env';
import { AllowWhenBlocked, AllowWithoutMfa, CurrentAuth, Public } from './auth.decorators';
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
  type LoginInput,
  loginSchema,
  type SwitchTenantInput,
  switchTenantSchema,
  type TotpCodeInput,
  totpCodeSchema,
} from './auth.schemas';
import { AuthService, type SessionResult } from './auth.service';
import type { AuthContext, RequestMeta } from './auth.types';

export const REFRESH_COOKIE = 'chegai_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';

function requestMeta(request: Request): RequestMeta {
  return {
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

function readRefreshCookie(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}

@AllowWhenBlocked()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithSession(response, await this.auth.login(body, requestMeta(request)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.refresh(readRefreshCookie(request), requestMeta(request));
    return this.respondWithSession(response, session);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(readRefreshCookie(request));
    response.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Public()
  @Get('invitations/:token')
  previewInvitation(@Param('token') token: string) {
    return this.auth.previewInvitation(token);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  async acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.acceptInvitation(body, requestMeta(request));
    return this.respondWithSession(response, session);
  }

  @Get('me')
  @AllowWithoutMfa()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  async switchTenant(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(switchTenantSchema)) body: SwitchTenantInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.switchTenant(auth, body.tenantSlug, requestMeta(request));
    return this.respondWithSession(response, session);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @AllowWithoutMfa()
  setupTotp(@CurrentAuth() auth: AuthContext) {
    return this.auth.setupTotp(auth);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @AllowWithoutMfa()
  async enableTotp(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.enableTotp(auth, body.code, requestMeta(request));
    return this.respondWithSession(response, session);
  }

  private respondWithSession(response: Response, session: SessionResult) {
    response.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: session.refreshTokenExpiresAt,
    });

    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
      tenant: session.tenant,
      tenants: session.tenants,
    };
  }
}
