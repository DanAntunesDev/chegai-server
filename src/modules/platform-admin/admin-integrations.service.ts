import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AppError } from '../../common/errors/app-error';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { recordAudit } from '../audit/audit';
import { PaymentGateway } from '../billing/payment-gateway';
import {
  INTEGRATIONS,
  type IntegrationKey,
  TENANT_INTEGRATIONS,
  type TenantIntegrationKey,
} from '../integrations/integration-catalog';
import { TenantSettingsService } from '../integrations/tenant-settings.service';
import { PlatformSettingsService } from '../integrations/platform-settings.service';
import { WebhookDispatcher } from '../integrations/webhook-dispatcher.service';
import { WEBHOOK_EVENTS } from '../integrations/webhook-events';
import type {
  TenantPaymentsInput,
  UpdateWebhookEndpointInput,
  WebhookEndpointInput,
} from './admin-integrations.schemas';

const endpointSelect = {
  id: true,
  tenantId: true,
  name: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AdminIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly tenantSettings: TenantSettingsService,
    private readonly dispatcher: WebhookDispatcher,
    private readonly gateway: PaymentGateway,
    private readonly encryption: EncryptionService,
  ) {}

  async list() {
    const keys = Object.keys(INTEGRATIONS) as IntegrationKey[];
    const values = await Promise.all(keys.map((key) => this.settings.masked(key)));
    return {
      integrations: Object.fromEntries(keys.map((key, index) => [key, values[index]])),
      events: WEBHOOK_EVENTS,
    };
  }

  async save(key: IntegrationKey, body: unknown, actorId: string) {
    const parsed = INTEGRATIONS[key].schema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('VALIDATION_FAILED', 'Invalid settings', parsed.error.flatten());
    }
    const values = await this.settings.set(key, parsed.data, actorId);
    await this.audit(
      actorId,
      null,
      'platform_integration.updated',
      'platform_integration',
      key,
      undefined,
      values,
    );
    return values;
  }

  async test(key: IntegrationKey) {
    const values = await this.settings.get(key);
    if (key === 'asaas') {
      return this.gateway.testConnection();
    }
    if (key === 'n8n') {
      if (!values.baseUrl) {
        return { ok: false, detail: 'Informe a URL do n8n' };
      }
      try {
        const response = await fetch(new URL('/healthz', values.baseUrl), {
          signal: AbortSignal.timeout(5_000),
        });
        return {
          ok: response.ok,
          detail: response.ok ? 'n8n respondeu' : `HTTP ${response.status}`,
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Sem resposta' };
      }
    }
    if (key === 'whatsapp') {
      if (!values.accessToken || !values.phoneNumberId) {
        return { ok: false, detail: 'Informe o token e o ID do número' };
      }
      try {
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(values.phoneNumberId)}?fields=display_phone_number`,
          {
            headers: { Authorization: `Bearer ${values.accessToken}` },
            signal: AbortSignal.timeout(5_000),
          },
        );
        return {
          ok: response.ok,
          detail: response.ok ? 'Número encontrado na Meta' : `HTTP ${response.status}`,
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Sem resposta' };
      }
    }
    const required: Record<string, string[]> = {
      google: ['clientId', 'clientSecret'],
      openai: ['apiKey'],
    };
    const missing = (required[key] ?? []).filter((field) => !values[field]);
    return missing.length
      ? { ok: false, detail: `Faltando: ${missing.join(', ')}` }
      : { ok: true, detail: 'Credenciais salvas' };
  }

  listWebhooks(tenantId?: string) {
    return this.prisma.asSystem((tx) =>
      tx.webhookEndpoint.findMany({
        where: tenantId ? { tenantId } : undefined,
        orderBy: { createdAt: 'desc' },
        select: { ...endpointSelect, tenant: { select: { displayName: true } } },
      }),
    );
  }

  async createWebhook(input: WebhookEndpointInput, actorId: string) {
    await this.checkUrl(input.url);
    const secret = this.dispatcher.newSecret();
    const endpoint = await this.prisma.asSystem((tx) =>
      tx.webhookEndpoint.create({
        data: {
          name: input.name,
          url: input.url,
          events: input.events,
          tenantId: input.tenantId ?? null,
          isActive: input.isActive ?? true,
          secret: this.encryption.encrypt(secret),
        },
        select: endpointSelect,
      }),
    );
    await this.audit(
      actorId,
      endpoint.tenantId,
      'webhook.created',
      'webhook',
      endpoint.id,
      undefined,
      {
        name: endpoint.name,
        url: endpoint.url,
        events: endpoint.events,
      },
    );
    return { ...endpoint, secret };
  }

  async updateWebhook(id: string, input: UpdateWebhookEndpointInput, actorId: string) {
    if (input.url) {
      await this.checkUrl(input.url);
    }
    const before = await this.findWebhook(id);
    const updated = await this.prisma.asSystem((tx) =>
      tx.webhookEndpoint.update({ where: { id }, data: input, select: endpointSelect }),
    );
    await this.audit(
      actorId,
      before.tenantId,
      'webhook.updated',
      'webhook',
      id,
      { name: before.name, url: before.url, events: before.events, isActive: before.isActive },
      { name: updated.name, url: updated.url, events: updated.events, isActive: updated.isActive },
    );
    return updated;
  }

  async rotateSecret(id: string, actorId: string) {
    const endpoint = await this.findWebhook(id);
    await this.audit(actorId, endpoint.tenantId, 'webhook.secret_rotated', 'webhook', id);
    const secret = this.dispatcher.newSecret();
    await this.prisma.asSystem((tx) =>
      tx.webhookEndpoint.update({
        where: { id },
        data: { secret: this.encryption.encrypt(secret) },
      }),
    );
    return { secret };
  }

  async deleteWebhook(id: string, actorId: string) {
    const endpoint = await this.findWebhook(id);
    await this.prisma.asSystem((tx) => tx.webhookEndpoint.delete({ where: { id } }));
    await this.audit(actorId, endpoint.tenantId, 'webhook.deleted', 'webhook', id, {
      name: endpoint.name,
      url: endpoint.url,
    });
    return { deleted: true };
  }

  async deliveries(id: string) {
    await this.findWebhook(id);
    return this.prisma.asSystem((tx) =>
      tx.webhookDelivery.findMany({
        where: { endpointId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          event: true,
          attempts: true,
          statusCode: true,
          ok: true,
          error: true,
          createdAt: true,
          deliveredAt: true,
        },
      }),
    );
  }

  async ping(id: string) {
    const endpoint = await this.findWebhook(id);
    return this.dispatcher.deliver(endpoint, 'ping', {
      event: 'ping',
      tenantId: endpoint.tenantId,
      occurredAt: new Date().toISOString(),
      data: { message: 'Teste de webhook do Chegaí' },
    });
  }

  async tenantIntegrations(tenantId: string) {
    const payments = await this.tenantPayments(tenantId);
    return { asaas: payments, ...(await this.tenantSettings.all(tenantId)) };
  }

  async saveTenantIntegration(
    tenantId: string,
    key: TenantIntegrationKey,
    body: unknown,
    actorId: string,
  ) {
    await this.tenantPayments(tenantId);
    const parsed = TENANT_INTEGRATIONS[key].schema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('VALIDATION_FAILED', 'Invalid settings', parsed.error.flatten());
    }
    const data: Record<string, string | undefined> = parsed.data;
    if (key === 'n8n' && data.agentWebhookUrl) {
      await this.checkUrl(data.agentWebhookUrl);
    }
    const values = await this.tenantSettings.set(tenantId, key, data, actorId);
    await this.audit(
      actorId,
      tenantId,
      'integration.updated',
      'tenant_integration',
      key,
      undefined,
      values,
    );
    return values;
  }

  async testTenantIntegration(tenantId: string, key: TenantIntegrationKey) {
    const values = await this.tenantSettings.get(tenantId, key);
    if (key === 'whatsapp') {
      const platform = await this.settings.get('whatsapp');
      const token = values.accessToken ?? platform.accessToken;
      if (!token || !values.phoneNumberId) {
        return { ok: false, detail: 'Informe o ID do número e um token de acesso' };
      }
      try {
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(values.phoneNumberId)}?fields=display_phone_number,verified_name`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) },
        );
        if (!response.ok) {
          return { ok: false, detail: `A Meta respondeu HTTP ${response.status}` };
        }
        const body = (await response.json()) as {
          display_phone_number?: string;
          verified_name?: string;
        };
        return {
          ok: true,
          detail: `Número ${body.display_phone_number ?? ''} (${body.verified_name ?? 'sem nome'}) conectado`,
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Sem resposta' };
      }
    }
    if (key === 'n8n') {
      return values.agentWebhookUrl
        ? { ok: true, detail: 'Webhook do agente salvo' }
        : { ok: false, detail: 'Informe o webhook do agente' };
    }
    return values.calendarId
      ? { ok: true, detail: 'Agenda informada. A sincronização usa as credenciais da plataforma.' }
      : { ok: false, detail: 'Informe o ID da agenda' };
  }

  async tenantPayments(tenantId: string) {
    const tenant = await this.prisma.asSystem((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { depositPercent: true, paymentApiKey: true },
      }),
    );
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND', 'Tenant not found');
    }
    return { depositPercent: tenant.depositPercent, ownAccount: Boolean(tenant.paymentApiKey) };
  }

  async saveTenantPayments(tenantId: string, input: TenantPaymentsInput, actorId: string) {
    const before = await this.tenantPayments(tenantId);
    if (input.apiKey) {
      const check = await this.gateway.testConnection(input.apiKey);
      if (!check.ok) {
        throw AppError.badRequest('PAYMENT_KEY_REJECTED', check.detail);
      }
    }
    await this.prisma.asSystem((tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: {
          depositPercent: input.depositPercent,
          paymentApiKey:
            input.apiKey === undefined
              ? undefined
              : input.apiKey
                ? this.encryption.encrypt(input.apiKey)
                : null,
        },
      }),
    );
    const after = await this.tenantPayments(tenantId);
    await this.audit(actorId, tenantId, 'payments.updated', 'tenant', tenantId, before, after);
    return after;
  }

  private audit(
    actorId: string,
    tenantId: string | null,
    action: string,
    entity: string,
    entityId: string,
    before?: Prisma.InputJsonValue,
    after?: Prisma.InputJsonValue,
  ) {
    return this.prisma.asSystem((tx) =>
      recordAudit(tx, { tenantId, actorUserId: actorId, action, entity, entityId, before, after }),
    );
  }

  private async checkUrl(url: string) {
    try {
      await this.dispatcher.checkUrl(url);
    } catch (error) {
      throw AppError.badRequest(
        'INVALID_WEBHOOK_URL',
        error instanceof Error ? error.message : 'invalid url',
      );
    }
  }

  private async findWebhook(id: string) {
    const endpoint = await this.prisma.asSystem((tx) =>
      tx.webhookEndpoint.findUnique({ where: { id } }),
    );
    if (!endpoint) {
      throw AppError.notFound('WEBHOOK_NOT_FOUND', 'Webhook not found');
    }
    return endpoint;
  }
}
