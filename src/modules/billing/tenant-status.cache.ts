import { Injectable } from '@nestjs/common';
import type { TenantStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const TTL_MS = 30_000;

@Injectable()
export class TenantStatusCache {
  private readonly entries = new Map<string, { status: TenantStatus | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string): Promise<TenantStatus | null> {
    const cached = this.entries.get(tenantId);
    if (cached && Date.now() - cached.at < TTL_MS) {
      return cached.status;
    }
    const tenant = await this.prisma.asSystem((tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } }),
    );
    const status = tenant?.status ?? null;
    this.entries.set(tenantId, { status, at: Date.now() });
    return status;
  }

  forget(tenantId: string) {
    this.entries.delete(tenantId);
  }
}
