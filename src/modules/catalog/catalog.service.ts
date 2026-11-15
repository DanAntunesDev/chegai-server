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
      tx.service
        .findMany({
          where: { deletedAt: null, isActive: input.includeInactive ? undefined : true },
          include: {
            category: { select: { id: true, name: true } },
            comboItems: { select: { serviceId: true } },
          },
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
        })
        .then((services) =>
          services.map(({ comboItems, ...service }) => ({
            ...service,
            includes: comboItems.map((item) => item.serviceId),
          })),
        ),
    );
  }

  createService(auth: TenantAuthContext, input: CreateServiceInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      if (input.categoryId) {
        await this.findCategory(tx, input.categoryId);
      }
      const { includes, ...data } = input;
      const service = await tx.service.create({ data: { ...data, tenantId: auth.tenantId } });
      await this.saveComboItems(tx, auth.tenantId, service.id, includes);
      return { ...service, includes: includes ?? [] };
    });
  }

  updateService(auth: TenantAuthContext, id: string, input: UpdateServiceInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.findService(tx, id);
      if (input.categoryId) {
        await this.findCategory(tx, input.categoryId);
      }
      const { includes, ...data } = input;
      const service = await tx.service.update({ where: { id }, data });
      await this.saveComboItems(tx, auth.tenantId, id, includes);
      const items = await tx.serviceComboItem.findMany({
        where: { comboId: id },
        select: { serviceId: true },
      });
      return { ...service, includes: items.map((item) => item.serviceId) };
    });
  }

  removeService(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.findService(tx, id);
      await tx.service.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
  }

  private async saveComboItems(
    tx: TransactionClient,
    tenantId: string,
    comboId: string,
    includes: string[] | undefined,
  ) {
    if (includes === undefined) {
      return;
    }
    const ids = [...new Set(includes)];
    if (ids.includes(comboId)) {
      throw AppError.badRequest('INVALID_COMBO', 'A combo cannot include itself');
    }
    if (ids.length) {
      const found = await tx.service.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, comboItems: { select: { serviceId: true } } },
      });
      if (found.length !== ids.length) {
        throw AppError.notFound('SERVICE_NOT_FOUND', 'One or more services were not found');
      }
      if (found.some((service) => service.comboItems.length > 0)) {
        throw AppError.badRequest('INVALID_COMBO', 'A combo cannot include another combo');
      }
    }
    await tx.serviceComboItem.deleteMany({ where: { comboId } });
    if (ids.length) {
      await tx.serviceComboItem.createMany({
        data: ids.map((serviceId) => ({ tenantId, comboId, serviceId })),
      });
    }
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
