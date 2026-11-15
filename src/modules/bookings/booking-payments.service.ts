import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AppError } from '../../common/errors/app-error';
import type { BookingPaymentKind } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { PaymentGateway } from '../billing/payment-gateway';
import { WebhookDispatcher } from '../integrations/webhook-dispatcher.service';
import { assertCanManageBooking, assertCanViewBooking } from './booking-access';
import type { CreatePaymentLinkInput, PaymentSettingsInput } from './booking-payments.schemas';

const MIN_CHARGE_CENTS = 500;
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
export class BookingPaymentsService {
  private readonly logger = new Logger(BookingPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly encryption: EncryptionService,
    private readonly webhooks: WebhookDispatcher,
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

    const services = booking.items.map((item) => item.name).join(' + ');
    const apiKey = tenant.paymentApiKey ? this.encryption.decrypt(tenant.paymentApiKey) : undefined;
    let link: { id: string; url: string };
    try {
      link = await this.gateway.createPaymentLink(
        {
          name: `${KIND_LABEL[input.kind]} - ${tenant.displayName}`.slice(0, 60),
          description: `${services} em ${booking.startsAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
          amountCents,
          dueDays: 3,
        },
        apiKey,
      );
    } catch (error) {
      this.logger.warn(`payment link failed for booking ${booking.id}: ${String(error)}`);
      throw AppError.badRequest(
        'PAYMENT_PROVIDER_ERROR',
        'The payment provider did not accept the request',
      );
    }

    const payment = await this.prisma.withTenant(auth.tenantId, (tx) =>
      tx.bookingPayment.create({
        data: {
          tenantId: auth.tenantId,
          bookingId: booking.id,
          kind: input.kind,
          amountCents,
          provider: this.gateway.name,
          providerLinkId: link.id,
          paymentUrl: link.url,
          createdById: auth.userId,
        },
        select: paymentSelect,
      }),
    );
    this.webhooks.emit('payment.link_created', auth.tenantId, {
      bookingId: booking.id,
      paymentId: payment.id,
      kind: payment.kind,
      amountCents,
      url: link.url,
    });
    return { payment, reused: false };
  }

  settings(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { depositPercent: true, paymentApiKey: true },
      });
      return { depositPercent: tenant.depositPercent, ownAccount: Boolean(tenant.paymentApiKey) };
    });
  }

  async updateSettings(tenantId: string, input: PaymentSettingsInput) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { depositPercent: input.depositPercent } }),
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
