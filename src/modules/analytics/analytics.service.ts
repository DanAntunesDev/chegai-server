import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type TransactionClient } from '../../prisma/prisma.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { localMinuteToInstant } from '../availability/zoned-time';
import type { SummaryQuery } from './analytics.schemas';

interface Totals {
  revenue_cents: number;
  completed: number;
  booked: number;
  no_shows: number;
  canceled: number;
  booked_minutes: number;
  new_customers: number;
}

interface Window {
  start: Date;
  end: Date;
  available: number;
}

function previousMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return date.toISOString().slice(0, 7);
}

function nextMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 7);
}

function change(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  summary(auth: TenantAuthContext, query: SummaryQuery) {
    return this.prisma.withTenant(auth.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { timezone: true },
      });
      const current = await this.window(tx, query.month, tenant.timezone, query.unitId);
      const previous = await this.window(
        tx,
        previousMonth(query.month),
        tenant.timezone,
        query.unitId,
      );
      const now = await this.totals(tx, current, query.unitId);
      const before = await this.totals(tx, previous, query.unitId);

      const describe = (totals: Totals, window: Window) => {
        const attended = totals.completed;
        return {
          revenueCents: totals.revenue_cents,
          completedBookings: attended,
          averageTicketCents: attended ? Math.round(totals.revenue_cents / attended) : 0,
          occupancyRate: window.available
            ? Math.round((totals.booked_minutes / window.available) * 1000) / 10
            : 0,
          noShowRate: totals.booked ? Math.round((totals.no_shows / totals.booked) * 1000) / 10 : 0,
          canceledBookings: totals.canceled,
          newCustomers: totals.new_customers,
        };
      };

      const currentSummary = describe(now, current);
      const previousSummary = describe(before, previous);
      return {
        month: query.month,
        current: currentSummary,
        previous: previousSummary,
        change: {
          revenue: change(currentSummary.revenueCents, previousSummary.revenueCents),
          completedBookings: change(
            currentSummary.completedBookings,
            previousSummary.completedBookings,
          ),
          averageTicket: change(
            currentSummary.averageTicketCents,
            previousSummary.averageTicketCents,
          ),
          occupancy: change(currentSummary.occupancyRate, previousSummary.occupancyRate),
          noShow: change(currentSummary.noShowRate, previousSummary.noShowRate),
        },
      };
    });
  }

  private async window(
    tx: TransactionClient,
    month: string,
    timezone: string,
    unitId?: string,
  ): Promise<Window> {
    const start = localMinuteToInstant(`${month}-01`, 0, timezone);
    const end = localMinuteToInstant(`${nextMonth(month)}-01`, 0, timezone);
    const unitFilter = unitId ? Prisma.sql`AND w.unit_id = ${unitId}::uuid` : Prisma.empty;
    const rows = await tx.$queryRaw<{ minutes: number }[]>`
      SELECT COALESCE(SUM((w.end_minute - w.start_minute) * days.count), 0)::int AS minutes
        FROM working_hours w
        JOIN staff s ON s.id = w.staff_id AND s.deleted_at IS NULL AND s.is_active
        JOIN LATERAL (
          SELECT COUNT(*)::int AS count
            FROM generate_series(${start}::timestamptz, ${end}::timestamptz - interval '1 day', interval '1 day') AS day
           WHERE EXTRACT(DOW FROM day AT TIME ZONE ${timezone}) = w.weekday
        ) days ON true
       WHERE true ${unitFilter}`;
    return { start, end, available: rows[0]?.minutes ?? 0 };
  }

  private async totals(tx: TransactionClient, window: Window, unitId?: string): Promise<Totals> {
    const unitFilter = unitId ? Prisma.sql`AND unit_id = ${unitId}::uuid` : Prisma.empty;
    const rows = await tx.$queryRaw<Totals[]>`
      SELECT
        COALESCE(SUM(total_price_cents) FILTER (WHERE status = 'COMPLETED'), 0)::int AS revenue_cents,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'))::int AS booked,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_shows,
        COUNT(*) FILTER (WHERE status = 'CANCELED' AND cancel_reason IS DISTINCT FROM 'HOLD_EXPIRED')::int AS canceled,
        COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60)
          FILTER (WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')), 0)::int AS booked_minutes,
        0 AS new_customers
        FROM bookings
       WHERE starts_at >= ${window.start} AND starts_at < ${window.end} ${unitFilter}`;
    const customers = await tx.customer.count({
      where: { createdAt: { gte: window.start, lt: window.end }, deletedAt: null },
    });
    return { ...rows[0], new_customers: customers };
  }
}
