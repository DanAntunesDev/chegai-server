import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import { parseBody, pickHeaders, redact } from './redact';

const SKIPPED = [/^\/health$/, /^\/v1\/public\/resolve/];

type LoggedRequest = Request & {
  auth?: AuthContext;
  customer?: { tenantId?: string; customerId?: string };
};

function routePath(request: Request): string | null {
  const route: unknown = request.route;
  if (route && typeof route === 'object' && 'path' in route && typeof route.path === 'string') {
    return route.path;
  }
  return null;
}

export function shouldLog(method: string, path: string, status: number) {
  if (SKIPPED.some((pattern) => pattern.test(path))) {
    return false;
  }
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' ? true : status >= 400;
}

@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLogMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  use(request: LoggedRequest, response: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    let captured: unknown;
    const send = response.send.bind(response);
    response.send = (body?: unknown) => {
      captured = body;
      return send(body);
    };

    response.on('finish', () => {
      const path = request.originalUrl.split('?')[0] ?? request.originalUrl;
      if (!shouldLog(request.method, path, response.statusCode)) {
        return;
      }
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      void this.save(request, response.statusCode, path, captured, durationMs);
    });
    next();
  }

  private async save(
    request: LoggedRequest,
    statusCode: number,
    path: string,
    captured: unknown,
    durationMs: number,
  ) {
    const body = parseBody(captured);
    const error =
      statusCode >= 400 && body && typeof body === 'object'
        ? (body as { code?: unknown; message?: unknown })
        : null;
    const auth = request.auth;
    const actor = auth
      ? auth.isPlatformAdmin
        ? 'admin'
        : 'staff'
      : request.customer
        ? 'customer'
        : path.startsWith('/v1/webhooks')
          ? 'webhook'
          : 'anonymous';
    try {
      await this.prisma.asSystem((tx) =>
        tx.requestLog.create({
          data: {
            tenantId: auth?.tenantId ?? request.customer?.tenantId ?? null,
            userId: auth?.userId ?? null,
            actor,
            method: request.method,
            path,
            route: routePath(request),
            query: redact(request.query) as Prisma.InputJsonValue,
            payload: redact(request.body) as Prisma.InputJsonValue,
            headers: pickHeaders(request.headers),
            statusCode,
            responseBody: redact(body) ?? undefined,
            errorCode: typeof error?.code === 'string' ? error.code : null,
            errorMessage: typeof error?.message === 'string' ? error.message.slice(0, 500) : null,
            durationMs,
            ip: request.ip ?? null,
            userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
          },
        }),
      );
    } catch (failure) {
      this.logger.warn(`request log not saved: ${String(failure)}`);
    }
  }
}
