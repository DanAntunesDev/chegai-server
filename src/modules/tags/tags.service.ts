import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import { recordAudit } from '../audit/audit';
import type { TenantAuthContext } from '../auth/auth.types';
import type { CreateTagInput, UpdateTagInput } from './tags.schemas';

export const tagSummary = { select: { id: true, name: true, color: true } } as const;

export function flattenTags<
  T extends { tags: { tag: { id: string; name: string; color: string } }[] },
>(record: T) {
  return { ...record, tags: record.tags.map((link) => link.tag) };
}

export async function assertTags(
  tx: TransactionClient,
  tagIds: string[],
  target: 'CUSTOMERS' | 'STAFF',
) {
  if (tagIds.length === 0) {
    return;
  }
  const found = await tx.tag.findMany({
    where: { id: { in: tagIds }, scope: { in: ['ALL', target] } },
    select: { id: true },
  });
  if (found.length !== new Set(tagIds).size) {
    throw AppError.badRequest('TAG_NOT_FOUND', 'One or more tags do not exist for this record');
  }
}

function assertCanManage(auth: TenantAuthContext) {
  if (
    !auth.permissions.includes('customers.manage') &&
    !auth.permissions.includes('staff.manage')
  ) {
    throw AppError.forbidden('PERMISSION_DENIED', 'You cannot manage tags');
  }
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: TenantAuthContext) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const tags = await tx.tag.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { customers: true, staff: true } } },
      });
      return tags.map(({ _count, ...tag }) => ({
        ...tag,
        customersCount: _count.customers,
        staffCount: _count.staff,
      }));
    });
  }

  create(auth: TenantAuthContext, input: CreateTagInput) {
    assertCanManage(auth);
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        const tag = await tx.tag.create({ data: { ...input, tenantId: auth.tenantId } });
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'tag.created',
          entity: 'tag',
          entityId: tag.id,
          after: { name: tag.name, color: tag.color, scope: tag.scope },
        });
        return tag;
      })
      .catch(rethrowNameConflict);
  }

  update(auth: TenantAuthContext, id: string, input: UpdateTagInput) {
    assertCanManage(auth);
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        const before = await this.find(tx, id);
        const tag = await tx.tag.update({ where: { id }, data: input });
        if (input.scope === 'CUSTOMERS') {
          await tx.staffTag.deleteMany({ where: { tagId: id } });
        }
        if (input.scope === 'STAFF') {
          await tx.customerTag.deleteMany({ where: { tagId: id } });
        }
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'tag.updated',
          entity: 'tag',
          entityId: id,
          before: {
            name: before.name,
            color: before.color,
            note: before.note,
            scope: before.scope,
          },
          after: { name: tag.name, color: tag.color, note: tag.note, scope: tag.scope },
        });
        return tag;
      })
      .catch(rethrowNameConflict);
  }

  remove(auth: TenantAuthContext, id: string) {
    assertCanManage(auth);
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const tag = await this.find(tx, id);
      await tx.tag.delete({ where: { id } });
      await recordAudit(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'tag.deleted',
        entity: 'tag',
        entityId: id,
        before: { name: tag.name, color: tag.color },
      });
    });
  }

  private async find(tx: TransactionClient, id: string) {
    const tag = await tx.tag.findUnique({ where: { id } });
    if (!tag) {
      throw AppError.notFound('TAG_NOT_FOUND', 'Tag not found');
    }
    return tag;
  }
}

function rethrowNameConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw AppError.conflict('TAG_NAME_TAKEN', 'A tag with this name already exists');
  }
  throw error;
}
