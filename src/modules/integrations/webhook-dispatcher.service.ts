import { createHmac, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../common/crypto/encryption.service';
import type { Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertPublicUrl } from './safe-url';
import type { WebhookEvent } from './webhook-events';

const RETRY_DELAYS_MS = [0, 10_000, 60_000];

export function signPayload(secret: string, timestamp: string, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly allowInsecure: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    config: ConfigService<Env, true>,
  ) {
    this.allowInsecure = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  newSecret() {
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }

  async checkUrl(url: string) {
    await assertPublicUrl(url, this.allowInsecure);
  }

  emit(event: WebhookEvent, tenantId: string | null, data: Record<string, unknown>) {
    void this.fanOut(event, tenantId, data).catch((error: unknown) =>
      this.logger.warn(`webhook fan-out failed for ${event}: ${String(error)}`),
    );
  }

  async fanOut(event: WebhookEvent, tenantId: string | null, data: Record<string, unknown>) {
    const endpoints = await this.prisma.asSystem((tx) =>
      tx.webhookEndpoint.findMany({
        where: {
          isActive: true,
          events: { has: event },
          OR: tenantId ? [{ tenantId: null }, { tenantId }] : [{ tenantId: null }],
        },
      }),
    );
    const payload = { event, tenantId, occurredAt: new Date().toISOString(), data };
    await Promise.all(endpoints.map((endpoint) => this.deliver(endpoint, event, payload)));
  }

  async deliver(
    endpoint: { id: string; url: string; secret: string },
    event: string,
    payload: Record<string, unknown>,
  ) {
    const delivery = await this.prisma.asSystem((tx) =>
      tx.webhookDelivery.create({
        data: { endpointId: endpoint.id, event, payload: payload as Prisma.InputJsonValue },
      }),
    );
    const body = JSON.stringify({ id: delivery.id, ...payload });
    const secret = this.encryption.decrypt(endpoint.secret);

    for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      let statusCode: number | null = null;
      let error: string;
      try {
        await this.checkUrl(endpoint.url);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const response = await fetch(endpoint.url, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Chegai-Webhooks/1',
            'X-Chegai-Event': event,
            'X-Chegai-Delivery': delivery.id,
            'X-Chegai-Timestamp': timestamp,
            'X-Chegai-Signature': `sha256=${signPayload(secret, timestamp, body)}`,
          },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        statusCode = response.status;
        if (response.ok) {
          await this.record(delivery.id, attempt + 1, statusCode, true, null);
          return { ok: true, statusCode };
        }
        error = `HTTP ${response.status}`;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      await this.record(delivery.id, attempt + 1, statusCode, false, error);
    }
    return { ok: false };
  }

  private record(
    id: string,
    attempts: number,
    statusCode: number | null,
    ok: boolean,
    error: string | null,
  ) {
    return this.prisma.asSystem((tx) =>
      tx.webhookDelivery.update({
        where: { id },
        data: {
          attempts,
          statusCode,
          ok,
          error: error?.slice(0, 500) ?? null,
          deliveredAt: ok ? new Date() : null,
        },
      }),
    );
  }
}
