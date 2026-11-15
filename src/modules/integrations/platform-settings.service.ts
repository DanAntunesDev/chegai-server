import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type IntegrationKey,
  type IntegrationValues,
  maskSettings,
  mergeSettings,
} from './integration-catalog';

const TTL_MS = 30_000;

@Injectable()
export class PlatformSettingsService {
  private readonly cache = new Map<string, { value: IntegrationValues; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(key: IntegrationKey): Promise<IntegrationValues> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const row = await this.prisma.asSystem((tx) =>
      tx.platformSetting.findUnique({ where: { key } }),
    );
    const value = row ? (JSON.parse(this.encryption.decrypt(row.value)) as IntegrationValues) : {};
    this.cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  async set(key: IntegrationKey, incoming: IntegrationValues, actorId: string) {
    const next = mergeSettings(key, await this.get(key), incoming);
    const value = this.encryption.encrypt(JSON.stringify(next));
    await this.prisma.asSystem((tx) =>
      tx.platformSetting.upsert({
        where: { key },
        create: { key, value, updatedById: actorId },
        update: { value, updatedById: actorId, updatedAt: new Date() },
      }),
    );
    this.cache.delete(key);
    return maskSettings(key, next);
  }

  async masked(key: IntegrationKey) {
    return maskSettings(key, await this.get(key));
  }
}
