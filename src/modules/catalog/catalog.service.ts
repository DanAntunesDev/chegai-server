import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import type {
  CategoryInput,
  CreateServiceInput,
  ListServicesInput,
  UpdateCategoryInput,
  UpdateServiceInput,
} from './catalog.schemas';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories(auth: TenantAuthContext) {
    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.serviceCategory.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    );
  }

  createCategory(auth: TenantAuthContext, input: CategoryInput) {
    return this.prisma
      .withTenant(auth.tenantId, (tx) =>
        tx.serviceCategory.create({ data: { ...input, tenantId: auth.tenantId } }),
      )
      .catch(rethrowNameConflict);
  }

  updateCategory(auth: TenantAuthContext, id: string, input: UpdateCategoryInput) {
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        await this.findCategory(tx, id);
        return tx.serviceCategory.update({ where: { id }, data: input });
      })
      .catch(rethrowNameConflict);
  }

  removeCategory(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.findCategory(tx, id);
      await tx.serviceCategory.delete({ where: { id } });
    });
  }

  listServices(auth: TenantAuthContext, input: ListServicesInput) {
    return this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.service.findMany({
        where: { deletedAt: null, isActive: input.includeInactive ? undefined : true },
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  createService(auth: TenantAuthContext, input: CreateServiceInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      if (input.categoryId) {
        await this.findCategory(tx, input.categoryId);
      }
      return tx.service.create({ data: { ...input, tenantId: auth.tenantId } });
    });
  }

  updateService(auth: TenantAuthContext, id: string, input: UpdateServiceInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.findService(tx, id);
      if (input.categoryId) {
        await this.findCategory(tx, input.categoryId);
      }
      return tx.service.update({ where: { id }, data: input });
    });
  }

  removeService(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.findService(tx, id);
      await tx.service.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
  }

  private async findCategory(tx: TransactionClient, id: string) {
    const category = await tx.serviceCategory.findUnique({ where: { id } });
    if (!category) {
      throw AppError.notFound('CATEGORY_NOT_FOUND', 'Category not found');
    }
    return category;
  }

  private async findService(tx: TransactionClient, id: string) {
    const service = await tx.service.findFirst({ where: { id, deletedAt: null } });
    if (!service) {
      throw AppError.notFound('SERVICE_NOT_FOUND', 'Service not found');
    }
    return service;
  }
}

function rethrowNameConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw AppError.conflict('CATEGORY_NAME_TAKEN', 'A category with this name already exists');
  }
  throw error;
}
