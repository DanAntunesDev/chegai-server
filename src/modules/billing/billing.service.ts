import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  addBusinessDays,
  fromIsoDate,
  nextBusinessDay,
  toIsoDate,
} from '../../common/calendar/business-days';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import type { Env } from '../../config/env';
import type { InvoiceKind, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { localDateOf } from '../availability/zoned-time';
import { PaymentGateway } from './payment-gateway';
import { TenantStatusCache } from './tenant-status.cache';

const ISSUE_DAYS_BEFORE_DUE = 7;
const SETUP_DUE_IN_DAYS = 3;
const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);

export interface WebhookPayload {
  id?: string;
  event?: string;
  payment?: { id?: string };
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly graceDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly statusCache: TenantStatusCache,
    config: ConfigService<Env, true>,
  ) {
    this.graceDays = config.get('BILLING_GRACE_BUSINESS_DAYS', { infer: true });
  }

  async startSubscription(
    tenantId: string,
    input: { billingDay: number; chargeSetupFee: boolean },
    today = this.today(),
  ) {
    const tenant = await this.prisma.asSystem((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        include: { plan: true, subscription: true },
      }),
    );
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND', 'Barbershop not found');
    }
    if (tenant.subscription && !tenant.subscription.canceledAt) {
      throw AppError.conflict('SUBSCRIPTION_EXISTS', 'This barbershop already has a subscription');
    }

    const customerId =
      tenant.subscription?.providerCustomerId ??
      (await this.gateway.createCustomer({
        name: tenant.legalName,
        document: tenant.document,
        email: tenant.email,
        phone: tenant.phone,
        reference: tenant.id,
      }));

    await this.prisma.asSystem((tx) =>
      tx.subscription.upsert({
        where: { tenantId },
        create: {
          tenantId,
          billingDay: input.billingDay,
          providerCustomerId: customerId,
          startedAt: fromIsoDate(today),
        },
        update: {
          billingDay: input.billingDay,
          providerCustomerId: customerId,
          canceledAt: null,
          startedAt: fromIsoDate(today),
        },
      }),
    );

    if (input.chargeSetupFee && tenant.plan.setupFeeCents > 0) {
      await this.issue(tenantId, {
        kind: 'SETUP',
        period: 'setup',
        description: `Implantação Chegaí · plano ${tenant.plan.name}`,
        amountCents: tenant.plan.setupFeeCents,
        dueDate: toIsoDate(nextBusinessDay(addDays(fromIsoDate(today), SETUP_DUE_IN_DAYS))),
      });
    }
    await this.issueMonthly(today);
    return this.summary(tenantId);
  }

  async pixFor(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.withTenant(tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId },
        select: { status: true, providerPaymentId: true },
      }),
    );
    if (!invoice) {
      throw AppError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
    }
    if (invoice.status === 'PAID' || invoice.status === 'CANCELED' || !invoice.providerPaymentId) {
      throw AppError.conflict('INVOICE_NOT_PAYABLE', 'This invoice cannot be paid now');
    }
    return this.gateway.pixCode(invoice.providerPaymentId);
  }

  summary(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => ({
      subscription: await tx.subscription.findUnique({
        where: { tenantId },
        select: { billingDay: true, startedAt: true, canceledAt: true },
      }),
      invoices: await tx.invoice.findMany({
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
        take: 36,
        select: {
          id: true,
          kind: true,
          period: true,
          description: true,
          amountCents: true,
          dueDate: true,
          status: true,
          paymentUrl: true,
          paidAt: true,
        },
      }),
    }));
  }

  async runDaily(today = this.today()) {
    const issued = await this.issueMonthly(today);
    const retried = await this.retryPendingCharges();
    const overdue = await this.markOverdue(today);
    const blocked = await this.blockLate(today);
    return { issued, retried, overdue, blocked };
  }

  async handleWebhook(payload: WebhookPayload) {
    const eventId = payload.id ?? `${payload.event ?? 'unknown'}:${payload.payment?.id ?? ''}`;
    const type = payload.event ?? 'UNKNOWN';

    const fresh = await this.prisma.asSystem(async (tx) => {
      try {
        await tx.paymentWebhookEvent.create({
          data: {
            provider: this.gateway.name,
            eventId,
            type,
            payload: payload as Prisma.InputJsonValue,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return false;
        }
        throw error;
      }
    });
    if (!fresh) {
      return { duplicated: true };
    }

    const paymentId = payload.payment?.id;
    if (paymentId && PAID_EVENTS.has(type)) {
      await this.markPaid(paymentId);
    } else if (paymentId && type === 'PAYMENT_OVERDUE') {
      await this.prisma.asSystem((tx) =>
        tx.invoice.updateMany({
          where: { providerPaymentId: paymentId, status: 'PENDING' },
          data: { status: 'OVERDUE' },
        }),
      );
    }

    await this.prisma.asSystem((tx) =>
      tx.paymentWebhookEvent.update({
        where: { provider_eventId: { provider: this.gateway.name, eventId } },
        data: { processedAt: new Date() },
      }),
    );
    return { duplicated: false };
  }

  private async markPaid(providerPaymentId: string) {
    const tenantId = await this.prisma.asSystem(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { providerPaymentId } });
      if (!invoice) {
        return null;
      }
      if (invoice.status !== 'PAID') {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
      const stillOverdue = await tx.invoice.count({
        where: { tenantId: invoice.tenantId, status: 'OVERDUE' },
      });
      if (stillOverdue === 0) {
        await tx.tenant.updateMany({
          where: { id: invoice.tenantId, status: { in: ['TRIAL', 'PAST_DUE', 'BLOCKED'] } },
          data: { status: 'ACTIVE' },
        });
      }
      return invoice.tenantId;
    });
    if (tenantId) {
      this.statusCache.forget(tenantId);
    }
  }

  private async issueMonthly(today: string) {
    const subscriptions = await this.prisma.asSystem((tx) =>
      tx.subscription.findMany({
        where: { canceledAt: null, tenant: { status: { not: 'CANCELED' }, deletedAt: null } },
        include: {
          tenant: {
            include: {
              plan: true,
              units: { where: { deletedAt: null, isActive: true }, select: { id: true } },
            },
          },
        },
      }),
    );

    let issued = 0;
    const current = fromIsoDate(today);
    for (const subscription of subscriptions) {
      for (const offset of [0, 1]) {
        const month = new Date(
          Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1),
        );
        const period = toIsoDate(month).slice(0, 7);
        const due = nextBusinessDay(
          new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), subscription.billingDay)),
        );
        const issueFrom = addDays(due, -ISSUE_DAYS_BEFORE_DUE);
        if (current < issueFrom || due < subscription.startedAt) {
          continue;
        }
        const { plan, units } = subscription.tenant;
        const extraUnits = plan.extraUnitPriceCents > 0 ? Math.max(units.length - 1, 0) : 0;
        const amountCents = plan.monthlyPriceCents + extraUnits * plan.extraUnitPriceCents;
        const created = await this.issue(subscription.tenantId, {
          kind: 'MONTHLY',
          period,
          description:
            `Mensalidade Chegaí · plano ${plan.name} · ${period}` +
            (extraUnits ? ` · ${extraUnits} unidade(s) extra` : ''),
          amountCents,
          dueDate: toIsoDate(due),
        });
        if (created) {
          issued += 1;
        }
      }
    }
    return issued;
  }

  private async issue(
    tenantId: string,
    input: {
      kind: InvoiceKind;
      period: string;
      description: string;
      amountCents: number;
      dueDate: string;
    },
  ) {
    let invoiceId: string;
    try {
      const invoice = await this.prisma.withTenant(tenantId, (tx) =>
        tx.invoice.create({
          data: { tenantId, ...input, dueDate: fromIsoDate(input.dueDate) },
        }),
      );
      invoiceId = invoice.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
    await this.charge(invoiceId);
    return true;
  }

  private async retryPendingCharges() {
    const pending = await this.prisma.asSystem((tx) =>
      tx.invoice.findMany({
        where: { providerPaymentId: null, status: { in: ['PENDING', 'OVERDUE'] } },
        select: { id: true },
      }),
    );
    let retried = 0;
    for (const invoice of pending) {
      if (await this.charge(invoice.id)) {
        retried += 1;
      }
    }
    return retried;
  }

  private async charge(invoiceId: string) {
    const invoice = await this.prisma.asSystem((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { tenant: { include: { subscription: true } } },
      }),
    );
    const customerId = invoice?.tenant.subscription?.providerCustomerId;
    if (!invoice || !customerId || invoice.providerPaymentId) {
      return false;
    }
    try {
      const charge = await this.gateway.createCharge({
        customerId,
        amountCents: invoice.amountCents,
        dueDate: toIsoDate(invoice.dueDate),
        description: invoice.description,
        reference: invoice.id,
      });
      await this.prisma.asSystem((tx) =>
        tx.invoice.update({
          where: { id: invoice.id },
          data: { providerPaymentId: charge.id, paymentUrl: charge.paymentUrl },
        }),
      );
      return true;
    } catch (error) {
      this.logger.error(error, `could not create charge for invoice ${invoice.id}`);
      return false;
    }
  }

  private async markOverdue(today: string) {
    return this.prisma.asSystem(async (tx) => {
      const late = await tx.invoice.findMany({
        where: { status: 'PENDING', dueDate: { lt: fromIsoDate(today) } },
        select: { id: true, tenantId: true },
      });
      if (!late.length) {
        return 0;
      }
      await tx.invoice.updateMany({
        where: { id: { in: late.map((invoice) => invoice.id) } },
        data: { status: 'OVERDUE' },
      });
      await tx.tenant.updateMany({
        where: { id: { in: late.map((invoice) => invoice.tenantId) }, status: 'ACTIVE' },
        data: { status: 'PAST_DUE' },
      });
      return late.length;
    });
  }

  private async blockLate(today: string) {
    const blocked = await this.prisma.asSystem(async (tx) => {
      const overdue = await tx.invoice.findMany({
        where: { status: 'OVERDUE' },
        select: { tenantId: true, dueDate: true },
      });
      const limit = fromIsoDate(today);
      const tenantIds = [
        ...new Set(
          overdue
            .filter((invoice) => addBusinessDays(invoice.dueDate, this.graceDays) < limit)
            .map((invoice) => invoice.tenantId),
        ),
      ];
      if (!tenantIds.length) {
        return [];
      }
      await tx.tenant.updateMany({
        where: { id: { in: tenantIds }, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        data: { status: 'BLOCKED' },
      });
      return tenantIds;
    });
    blocked.forEach((tenantId) => this.statusCache.forget(tenantId));
    return blocked.length;
  }

  private today() {
    return localDateOf(new Date(), 'America/Sao_Paulo');
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}
