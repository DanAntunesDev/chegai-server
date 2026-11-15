import { timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env';
import { PlatformSettingsService } from '../integrations/platform-settings.service';
import {
  type CreatedCharge,
  type CreatedPaymentLink,
  type GatewayCharge,
  type GatewayCustomer,
  PaymentGateway,
  type PaymentLinkInput,
  type PixCode,
} from './payment-gateway';

interface AsaasError {
  errors?: { code?: string; description?: string }[];
}

@Injectable()
export class AsaasGateway extends PaymentGateway {
  readonly name = 'asaas';
  private readonly logger = new Logger('AsaasGateway');
  private readonly envUrl: string;
  private readonly envKey: string | undefined;
  private readonly envToken: string | undefined;

  constructor(
    config: ConfigService<Env, true>,
    private readonly settings: PlatformSettingsService,
  ) {
    super();
    this.envUrl = config.get('ASAAS_API_URL', { infer: true });
    this.envKey = config.get('ASAAS_API_KEY', { infer: true });
    this.envToken = config.get('ASAAS_WEBHOOK_TOKEN', { infer: true });
  }

  private async config() {
    const stored = await this.settings.get('asaas');
    return {
      baseUrl: (stored.apiUrl || this.envUrl).replace(/\/$/, ''),
      apiKey: stored.apiKey || this.envKey,
      webhookToken: stored.webhookToken || this.envToken,
    };
  }

  async createCustomer(customer: GatewayCustomer): Promise<string> {
    const body = await this.request<{ id: string }>('POST', '/customers', {
      name: customer.name,
      cpfCnpj: customer.document ?? undefined,
      email: customer.email,
      mobilePhone: customer.phone?.replace(/^\+55/, '') ?? undefined,
      externalReference: customer.reference,
      notificationDisabled: false,
    });
    return body.id;
  }

  async createCharge(charge: GatewayCharge): Promise<CreatedCharge> {
    const body = await this.request<{ id: string; invoiceUrl?: string }>('POST', '/payments', {
      customer: charge.customerId,
      billingType: 'UNDEFINED',
      value: charge.amountCents / 100,
      dueDate: charge.dueDate,
      description: charge.description,
      externalReference: charge.reference,
    });
    return { id: body.id, paymentUrl: body.invoiceUrl ?? null };
  }

  async cancelCharge(id: string): Promise<void> {
    await this.request('DELETE', `/payments/${encodeURIComponent(id)}`);
  }

  async pixCode(id: string): Promise<PixCode> {
    const body = await this.request<{
      encodedImage: string;
      payload: string;
      expirationDate?: string;
    }>('GET', `/payments/${encodeURIComponent(id)}/pixQrCode`);
    return {
      image: body.encodedImage,
      payload: body.payload,
      expiresAt: body.expirationDate ?? null,
    };
  }

  async createPaymentLink(input: PaymentLinkInput, apiKey?: string): Promise<CreatedPaymentLink> {
    const body = await this.request<{ id: string; url: string }>(
      'POST',
      '/paymentLinks',
      {
        name: input.name.slice(0, 100),
        description: input.description.slice(0, 500),
        billingType: 'UNDEFINED',
        chargeType: 'DETACHED',
        value: input.amountCents / 100,
        dueDateLimitDays: input.dueDays,
        notificationEnabled: false,
      },
      apiKey,
    );
    return { id: body.id, url: body.url };
  }

  async testConnection(apiKey?: string) {
    try {
      const body = await this.request<{ balance?: number }>(
        'GET',
        '/finance/balance',
        undefined,
        apiKey,
      );
      return {
        ok: true,
        detail: `Conectado. Saldo disponível: ${(body.balance ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
      };
    } catch (error) {
      return { ok: false, detail: error instanceof AppError ? error.message : 'Falha ao conectar' };
    }
  }

  async verifyWebhook(token: string | undefined): Promise<boolean> {
    const { webhookToken } = await this.config();
    if (!webhookToken || !token) {
      return false;
    }
    const expected = Buffer.from(webhookToken);
    const received = Buffer.from(token);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    apiKeyOverride?: string,
  ): Promise<T> {
    const { baseUrl, apiKey: platformKey } = await this.config();
    const apiKey = apiKeyOverride || platformKey;
    if (!apiKey) {
      throw new AppError('PAYMENTS_NOT_CONFIGURED', 'Payment provider is not configured', 503);
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'chegai-server',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as T & AsaasError;
    if (!response.ok) {
      const detail = payload.errors?.map((error) => error.description).join('; ');
      this.logger.error(`asaas ${method} ${path} failed with ${response.status}: ${detail ?? ''}`);
      throw new AppError(
        'PAYMENT_PROVIDER_ERROR',
        detail || 'Payment provider rejected the request',
        502,
      );
    }
    return payload;
  }
}
