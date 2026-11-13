import { timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env';
import {
  type CreatedCharge,
  type GatewayCharge,
  type GatewayCustomer,
  PaymentGateway,
  type PixCode,
} from './payment-gateway';

interface AsaasError {
  errors?: { code?: string; description?: string }[];
}

@Injectable()
export class AsaasGateway extends PaymentGateway {
  readonly name = 'asaas';
  private readonly logger = new Logger('AsaasGateway');
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly webhookToken: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.baseUrl = config.get('ASAAS_API_URL', { infer: true });
    this.apiKey = config.get('ASAAS_API_KEY', { infer: true });
    this.webhookToken = config.get('ASAAS_WEBHOOK_TOKEN', { infer: true });
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

  verifyWebhook(token: string | undefined): boolean {
    if (!this.webhookToken || !token) {
      return false;
    }
    const expected = Buffer.from(this.webhookToken);
    const received = Buffer.from(token);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new AppError('PAYMENTS_NOT_CONFIGURED', 'Payment provider is not configured', 503);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        access_token: this.apiKey,
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
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Payment provider rejected the request', 502);
    }
    return payload;
  }
}
