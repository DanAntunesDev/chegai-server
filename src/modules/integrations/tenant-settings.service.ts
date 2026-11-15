import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type IntegrationValues,
  maskValues,
  mergeValues,
  TENANT_INTEGRATIONS,
  type TenantIntegrationKey,
} from './integration-catalog';

@Injectable()
export class TenantSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(tenantId: string, key: TenantIntegrationKey): Promise<IntegrationValues> {
    const row = await this.prisma.asSystem((tx) =>
      tx.tenantIntegration.findUnique({ where: { tenantId_key: { tenantId, key } } }),
    );
    return row ? (JSON.parse(this.encryption.decrypt(row.value)) as IntegrationValues) : {};
  }

  async all(tenantId: string) {
    const rows = await this.prisma.asSystem((tx) =>
      tx.tenantIntegration.findMany({ where: { tenantId } }),
    );
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return Object.fromEntries(
      (Object.keys(TENANT_INTEGRATIONS) as TenantIntegrationKey[]).map((key) => {
        const row = byKey.get(key);
        const values = row
          ? (JSON.parse(this.encryption.decrypt(row.value)) as IntegrationValues)
          : {};
        return [
          key,
          {
            values: maskValues(TENANT_INTEGRATIONS[key].secrets, values),
            updatedAt: row?.updatedAt ?? null,
          },
        ];
      }),
    );
  }

  async set(
    tenantId: string,
    key: TenantIntegrationKey,
    incoming: IntegrationValues,
    actorId: string,
  ) {
    const next = mergeValues(
      TENANT_INTEGRATIONS[key].secrets,
      await this.get(tenantId, key),
      incoming,
    );
    const value = this.encryption.encrypt(JSON.stringify(next));
    await this.prisma.asSystem((tx) =>
      tx.tenantIntegration.upsert({
        where: { tenantId_key: { tenantId, key } },
        create: { tenantId, key, value, updatedById: actorId },
        update: { value, updatedById: actorId, updatedAt: new Date() },
      }),
    );
    return maskValues(TENANT_INTEGRATIONS[key].secrets, next);
  }
}
