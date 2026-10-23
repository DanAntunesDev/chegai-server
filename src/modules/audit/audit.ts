import type { Prisma } from '../../generated/prisma/client';
import type { TransactionClient } from '../../prisma/prisma.service';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export function recordAudit(tx: TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({ data: entry });
}
