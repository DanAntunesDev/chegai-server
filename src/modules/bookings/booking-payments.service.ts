import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AppError } from '../../common/errors/app-error';
import type { BookingPaymentKind } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { PaymentGateway } from '../billing/payment-gateway';
import { WebhookDispatcher } from '../integrations/webhook-dispatcher.service';
import { assertCanManageBooking, assertCanViewBooking } from './booking-access';
import { BookingsService } from './bookings.service';
import type { CreatePaymentLinkInput, PaymentSettingsInput } from './booking-payments.schemas';

const MIN_CHARGE_CENTS = 500;
const PAYMENT_HOLD_MINUTES = 30;
const PAYABLE_STATUSES = new Set(['CONFIRMED', 'CHECKED_IN', 'COMPLETED']);
const KIND_LABEL: Record<BookingPaymentKind, string> = {
  DEPOSIT: 'Sinal',
  FULL: 'Pagamento',
  REMAINDER: 'Restante',
};

export function amountFor(
  kind: BookingPaymentKind,
  totalCents: number,
  paidCents: number,
  depositPercent: number,
) {
  if (kind === 'DEPOSIT') {
    return Math.round((totalCents * depositPercent) / 100);
  }
  if (kind === 'FULL') {
    return totalCents;
  }
  return Math.max(totalCents - paidCents, 0);
}

const paymentSelect = {
  id: true,
  kind: true,
  status: true,
  amountCents: true,
  paymentUrl: true,
  paidAt: true,
  createdAt: true,
} as const;

@Injectable()
export class BookingPaymentsService implements OnModuleInit {
  private readonly logger = new Logger(BookingPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly encryption: EncryptionService,
    private readonly webhooks: WebhookDispatcher,
    private readonly billing: BillingService,
    private readonly bookings: BookingsService,
  ) {}

  list(auth: TenantAuthContext, bookingId: string) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.findBooking(tx, bookingId);
      assertCanViewBooking(auth, booking.staff.userId);
      return this.summary(booking.totalPriceCents, booking.payments);
    });
  }

  async createLink(auth: TenantAuthContext, bookingId: string, input: CreatePaymentLinkInput) {
    const context = await this.prisma.withTenant(auth.tenantId, async (tx) => {
      const booking = await this.findBooking(tx, bookingId);
      assertCanManageBooking(auth, booking.staff.userId);
      if (!PAYABLE_STATUSES.has(booking.status)) {
        throw AppError.conflict('BOOKING_NOT_PAYABLE', 'Only confirmed bookings can be charged');
      }
      const pending = booking.payments.find(
        (payment) => payment.kind === input.kind && payment.status === 'PENDING',
      );
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { displayName: true, depositPercent: true, paymentApiKey: true },
      });
      return { booking, pending, tenant };
    });

    const { booking, pending, tenant } = context;
    if (pending) {
      return { payment: pending, reused: true };
    }
    const paidCents = booking.payments
      .filter((payment) => payment.status === 'PAID')
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    if (input.kind !== 'REMAINDER' && paidCents > 0) {
      throw AppError.conflict(
        'ALREADY_PAID',
        'This booking already has a payment, charge the remainder',
      );
    }
    const amountCents = amountFor(
      input.kind,
      booking.totalPriceCents,
      paidCents,
      tenant.depositPercent,
    );
    if (amountCents < MIN_CHARGE_CENTS) {
      throw AppError.badRequest(
        'AMOUNT_TOO_LOW',
        'The amount is below the minimum charge of R$ 5,00',
      );
    }

    const payment = await this.issueLink(auth.tenantId, auth.userId, tenant, {
      bookingId: booking.id,
      kind: input.kind,
      amountCents,
      services: booking.items.map((item) => item.name).join(' + '),
      startsAt: booking.startsAt,
    });
    return { payment, reused: false };
  }

  onModuleInit() {
    this.billing.onLinkPaid(async (payment) => {
      try {
        await this.bookings.confirmPaid(payment.tenantId, payment.bookingId);
      } catch (error) {
        this.logger.warn(
          `paid booking ${payment.bookingId} could not be confirmed: ${String(error)}`,
        );
      }
    });
  }

  async checkoutPublic(
    tenantId: string,
    bookingId: string,
    customer: { phone: string; name: string; notes?: string },
  ) {
    const tenant = await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          displayName: true,
          depositPercent: true,
          depositRequired: true,
          paymentApiKey: true,
        },
      }),
    );
    const preview = await this.prisma.withTenant(tenantId, (tx) => this.findBooking(tx, bookingId));
    const amountCents = amountFor('DEPOSIT', preview.totalPriceCents, 0, tenant.depositPercent);
    if (!tenant.depositRequired || amountCents < MIN_CHARGE_CENTS) {
      return this.bookings.confirmPublic(tenantId, bookingId, customer);
    }

    const booking = await this.bookings.awaitPayment(
      tenantId,
      bookingId,
      customer,
      PAYMENT_HOLD_MINUTES,
    );
    const pending = preview.payments.find(
      (payment) => payment.kind === 'DEPOSIT' && payment.status === 'PENDING',
    );
    const payment =
      pending ??
      (await this.issueLink(tenantId, null, tenant, {
        bookingId,
        kind: 'DEPOSIT',
        amountCents,
        services: preview.items.map((item) => item.name).join(' + '),
        startsAt: preview.startsAt,
      }));
    return {
      ...this.bookings.presentPublic(booking),
      payment: {
        url: payment.paymentUrl,
        amountCents: payment.amountCents,
        expiresAt: booking.holdExpiresAt,
      },
    };
  }

  private async issueLink(
    tenantId: string,
    createdById: string | null,
    tenant: { displayName: string; paymentApiKey: string | null },
    input: {
      bookingId: string;
      kind: BookingPaymentKind;
      amountCents: number;
      services: string;
      startsAt: Date;
    },
  ) {
    const apiKey = tenant.paymentApiKey ? this.encryption.decrypt(tenant.paymentApiKey) : undefined;
    let link: { id: string; url: string };
    try {
      link = await this.gateway.createPaymentLink(
        {
          name: `${KIND_LABEL[input.kind]} - ${tenant.displayName}`.slice(0, 60),
          description: `${input.services} em ${input.startsAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
          amountCents: input.amountCents,
          dueDays: 3,
        },
        apiKey,
      );
    } catch (error) {
      this.logger.warn(`payment link failed for booking ${input.bookingId}: ${String(error)}`);
      throw AppError.badRequest(
        'PAYMENT_PROVIDER_ERROR',
        'The payment provider did not accept the request',
      );
    }
    const payment = await this.prisma.withTenant(tenantId, (tx) =>
      tx.bookingPayment.create({
        data: {
          tenantId,
          bookingId: input.bookingId,
          kind: input.kind,
          amountCents: input.amountCents,
          provider: this.gateway.name,
          providerLinkId: link.id,
          paymentUrl: link.url,
          createdById,
        },
        select: paymentSelect,
      }),
    );
    this.webhooks.emit('payment.link_created', tenantId, {
      bookingId: input.bookingId,
      paymentId: payment.id,
      kind: payment.kind,
      amountCents: input.amountCents,
      url: link.url,
    });
    return payment;
  }

  settings(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { depositPercent: true, depositRequired: true, paymentApiKey: true },
      });
      return {
        depositPercent: tenant.depositPercent,
        depositRequired: tenant.depositRequired,
        ownAccount: Boolean(tenant.paymentApiKey),
      };
    });
  }

  async updateSettings(tenantId: string, input: PaymentSettingsInput) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: { depositPercent: input.depositPercent, depositRequired: input.depositRequired },
      }),
    );
    return this.settings(tenantId);
  }

  private async findBooking(
    tx: Parameters<Parameters<PrismaService['withTenant']>[1]>[0],
    id: string,
  ) {
    const booking = await tx.booking.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: 'asc' } },
        staff: { select: { userId: true } },
        payments: { orderBy: { createdAt: 'asc' }, select: paymentSelect },
      },
    });
    if (!booking) {
      throw AppError.notFound('BOOKING_NOT_FOUND', 'Booking not found');
    }
    return booking;
  }

  private summary(
    totalCents: number,
    payments: { status: string; amountCents: number }[] & object[],
  ) {
    const paidCents = payments
      .filter((payment) => payment.status === 'PAID')
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    return { totalCents, paidCents, dueCents: Math.max(totalCents - paidCents, 0), payments };
  }
}
