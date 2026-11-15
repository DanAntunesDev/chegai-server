import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogsQuery, RequestLogsQuery } from './logs.schemas';

const REQUEST_LOG_DAYS = 30;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

function range(from?: string, to?: string) {
  if (!from && !to) {
    return undefined;
  }
  return {
    gte: from ? new Date(`${from}T00:00:00-03:00`) : undefined,
    lt: to ? new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86_400_000) : undefined,
  };
}

const STATUS_RANGE = {
  success: { lt: 400 },
  client_error: { gte: 400, lt: 500 },
  server_error: { gte: 500 },
} as const;

@Injectable()
export class LogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogsService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async sweep(now = new Date()) {
    const before = new Date(now.getTime() - REQUEST_LOG_DAYS * 86_400_000);
    const removed = await this.prisma.asSystem((tx) =>
      tx.requestLog.deleteMany({ where: { createdAt: { lt: before } } }),
    );
    if (removed.count) {
      this.logger.log(`removed ${removed.count} request logs older than ${REQUEST_LOG_DAYS} days`);
    }
    return removed.count;
  }

  async requests(query: RequestLogsQuery) {
    const where: Prisma.RequestLogWhereInput = {
      tenantId: query.tenantId,
      method: query.method,
      actor: query.actor,
      createdAt: range(query.from, query.to),
      statusCode: query.statusCode ?? (query.status ? STATUS_RANGE[query.status] : undefined),
      OR: query.search
        ? [
            { path: { contains: query.search, mode: 'insensitive' } },
            { errorCode: { contains: query.search, mode: 'insensitive' } },
            { ip: { startsWith: query.search } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.asSystem((tx) =>
      Promise.all([
        tx.requestLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            tenantId: true,
            userId: true,
            actor: true,
            method: true,
            path: true,
            statusCode: true,
            errorCode: true,
            durationMs: true,
            ip: true,
            createdAt: true,
          },
        }),
        tx.requestLog.count({ where }),
      ]),
    );
    return {
      items: await this.withNames(items),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async request(id: string) {
    const log = await this.prisma.asSystem((tx) => tx.requestLog.findUnique({ where: { id } }));
    if (!log) {
      throw AppError.notFound('LOG_NOT_FOUND', 'Log not found');
    }
    const [named] = await this.withNames([log]);
    return named;
  }

  async audits(query: AuditLogsQuery) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId: query.tenantId,
      action: query.action,
      createdAt: range(query.from, query.to),
      OR: query.search
        ? [
            { action: { contains: query.search, mode: 'insensitive' } },
            { entity: { contains: query.search, mode: 'insensitive' } },
            { entityId: { contains: query.search } },
          ]
        : undefined,
    };
    const [items, total, actions] = await this.prisma.asSystem((tx) =>
      Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          distinct: ['action'],
          select: { action: true },
          orderBy: { action: 'asc' },
        }),
      ]),
    );
    const named = await this.withNames(
      items.map((item) => ({ ...item, userId: item.actorUserId })),
    );
    return {
      items: named,
      total,
      page: query.page,
      pageSize: query.pageSize,
      actions: actions.map((item) => item.action),
    };
  }

  private async withNames<T extends { tenantId: string | null; userId: string | null }>(
    items: T[],
  ) {
    const tenantIds = [...new Set(items.map((item) => item.tenantId).filter((id) => id !== null))];
    const userIds = [...new Set(items.map((item) => item.userId).filter((id) => id !== null))];
    const [tenants, users] = await this.prisma.asSystem((tx) =>
      Promise.all([
        tenantIds.length
          ? tx.tenant.findMany({
              where: { id: { in: tenantIds } },
              select: { id: true, displayName: true, slug: true },
            })
          : [],
        userIds.length
          ? tx.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true, email: true },
            })
          : [],
      ]),
    );
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const userById = new Map(users.map((user) => [user.id, user]));
    return items.map((item) => ({
      ...item,
      tenant: item.tenantId ? (tenantById.get(item.tenantId) ?? null) : null,
      user: item.userId ? (userById.get(item.userId) ?? null) : null,
    }));
  }
}
