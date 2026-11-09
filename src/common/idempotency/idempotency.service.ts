import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../errors/app-error';
import { isUniqueViolation } from '../errors/prisma-errors';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

export interface IdempotentRequest {
  tenantId: string;
  key: string | undefined;
  scope: string;
  payload: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(request: IdempotentRequest, handler: () => Promise<T>): Promise<T> {
    if (request.key === undefined) {
      return handler();
    }
    if (!KEY_PATTERN.test(request.key)) {
      throw AppError.badRequest(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must have 8 to 100 letters, digits or ._:-',
      );
    }

    const requestHash = createHash('sha256')
      .update(request.scope)
      .update('\n')
      .update(JSON.stringify(request.payload ?? null))
      .digest('hex');

    const replay = await this.claim(request.tenantId, request.key, request.scope, requestHash);
    if (replay !== undefined) {
      return replay as T;
    }

    try {
      const result = await handler();
      await this.prisma.withTenant(request.tenantId, (tx) =>
        tx.idempotencyKey.update({
          where: { tenantId_key: { tenantId: request.tenantId, key: request.key as string } },
          data: { response: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue },
        }),
      );
      return result;
    } catch (error) {
      await this.prisma.withTenant(request.tenantId, (tx) =>
        tx.idempotencyKey.deleteMany({
          where: {
            tenantId: request.tenantId,
            key: request.key as string,
            response: { equals: Prisma.DbNull },
          },
        }),
      );
      throw error;
    }
  }

  private async claim(tenantId: string, key: string, scope: string, requestHash: string) {
    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.idempotencyKey.create({ data: { tenantId, key, scope, requestHash } }),
      );
      return undefined;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }

    const existing = await this.prisma.withTenant(tenantId, (tx) =>
      tx.idempotencyKey.findUnique({ where: { tenantId_key: { tenantId, key } } }),
    );
    if (!existing || existing.scope !== scope || existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (existing.response === null) {
      throw AppError.conflict(
        'IDEMPOTENCY_IN_PROGRESS',
        'A request with this Idempotency-Key is still being processed',
      );
    }
    return existing.response;
  }

  purgeOlderThan(date: Date) {
    return this.prisma.asSystem((tx) =>
      tx.idempotencyKey.deleteMany({ where: { createdAt: { lt: date } } }),
    );
  }
}
