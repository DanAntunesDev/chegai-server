import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { normalizeBrazilianPhone } from '../../common/validation/fields';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import type {
  CreateCustomerInput,
  ListCustomersInput,
  UpdateCustomerInput,
} from './customers.schemas';

function toData<T extends { birthDate?: string | null }>(input: T) {
  const { birthDate, ...rest } = input;
  return {
    ...rest,
    birthDate:
      birthDate === undefined ? undefined : birthDate && new Date(`${birthDate}T00:00:00Z`),
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: TenantAuthContext, input: ListCustomersInput) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const phone = input.search ? normalizeBrazilianPhone(input.search) : null;
      const where: Prisma.CustomerWhereInput = {
        deletedAt: null,
        tags: input.tag ? { has: input.tag } : undefined,
        OR: input.search
          ? [
              { name: { contains: input.search, mode: 'insensitive' } },
              { email: { contains: input.search, mode: 'insensitive' } },
              ...(phone ? [{ phone }] : []),
            ]
          : undefined,
      };

      const items = await tx.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      });
      const total = await tx.customer.count({ where });

      return { items, total, page: input.page, pageSize: input.pageSize };
    });
  }

  get(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, (tx) => this.find(tx, id));
  }

  create(auth: TenantAuthContext, input: CreateCustomerInput) {
    return this.prisma
      .withTenant(auth.tenantId, (tx) =>
        tx.customer.create({ data: { ...toData(input), tenantId: auth.tenantId } }),
      )
      .catch(rethrowPhoneConflict);
  }

  update(auth: TenantAuthContext, id: string, input: UpdateCustomerInput) {
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        await this.find(tx, id);
        return tx.customer.update({ where: { id }, data: toData(input) });
      })
      .catch(rethrowPhoneConflict);
  }

  remove(auth: TenantAuthContext, id: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      await this.find(tx, id);
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  private async find(tx: TransactionClient, id: string) {
    const customer = await tx.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) {
      throw AppError.notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    return customer;
  }
}

function rethrowPhoneConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw AppError.conflict('CUSTOMER_PHONE_TAKEN', 'A customer with this phone already exists');
  }
  throw error;
}
