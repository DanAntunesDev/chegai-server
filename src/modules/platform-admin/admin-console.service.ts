import { Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AppError } from '../../common/errors/app-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateUserInput,
  ListUsersInput,
  MetricsQuery,
  UpdateUserInput,
} from './admin-console.schemas';

const userSelect = {
  id: true,
  name: true,
  email: true,
  isPlatformAdmin: true,
  totpEnabledAt: true,
  lastLoginAt: true,
  createdAt: true,
  deletedAt: true,
  memberships: {
    where: { isActive: true },
    select: {
      tenant: { select: { id: true, displayName: true } },
      role: { select: { name: true } },
    },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminConsoleService {
  constructor(private readonly prisma: PrismaService) {}

  metrics(query: MetricsQuery) {
    return this.prisma.asSystem(async (tx) => {
      const from = new Date(`${query.from}T00:00:00-03:00`);
      const to = new Date(new Date(`${query.to}T00:00:00-03:00`).getTime() + 86_400_000);
      const tenantFilter = Prisma.sql`
        ${query.status ? Prisma.sql`AND t.status = ${query.status}::"TenantStatus"` : Prisma.empty}
        ${query.planCode ? Prisma.sql`AND p.code = ${query.planCode}` : Prisma.empty}`;

      const [overview] = await tx.$queryRaw<
        {
          total: number;
          trial: number;
          active: number;
          past_due: number;
          blocked: number;
          canceled: number;
          mrr_cents: number;
          new_in_period: number;
        }[]
      >`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE t.status = 'TRIAL')::int AS trial,
               COUNT(*) FILTER (WHERE t.status = 'ACTIVE')::int AS active,
               COUNT(*) FILTER (WHERE t.status = 'PAST_DUE')::int AS past_due,
               COUNT(*) FILTER (WHERE t.status = 'BLOCKED')::int AS blocked,
               COUNT(*) FILTER (WHERE t.status = 'CANCELED')::int AS canceled,
               COALESCE(SUM(p.monthly_price_cents) FILTER (WHERE t.status IN ('ACTIVE', 'PAST_DUE')), 0)::int AS mrr_cents,
               COUNT(*) FILTER (WHERE t.created_at >= ${from} AND t.created_at < ${to})::int AS new_in_period
          FROM tenants t
          JOIN plans p ON p.id = t.plan_id
         WHERE t.deleted_at IS NULL ${tenantFilter}`;

      const [bookings] = await tx.$queryRaw<
        {
          completed: number;
          gmv_cents: number;
          canceled: number;
          no_show: number;
          from_public: number;
          from_whatsapp: number;
          from_panel: number;
        }[]
      >`
        SELECT COUNT(*) FILTER (WHERE b.status = 'COMPLETED')::int AS completed,
               COALESCE(SUM(b.total_price_cents) FILTER (WHERE b.status = 'COMPLETED'), 0)::int AS gmv_cents,
               COUNT(*) FILTER (WHERE b.status = 'CANCELED')::int AS canceled,
               COUNT(*) FILTER (WHERE b.status = 'NO_SHOW')::int AS no_show,
               COUNT(*) FILTER (WHERE b.source = 'PUBLIC' AND b.status <> 'HOLD')::int AS from_public,
               COUNT(*) FILTER (WHERE b.source = 'WHATSAPP' AND b.status <> 'HOLD')::int AS from_whatsapp,
               COUNT(*) FILTER (WHERE b.source = 'PANEL' AND b.status <> 'HOLD')::int AS from_panel
          FROM bookings b
          JOIN tenants t ON t.id = b.tenant_id
          JOIN plans p ON p.id = t.plan_id
         WHERE b.starts_at >= ${from} AND b.starts_at < ${to} ${tenantFilter}`;

      const [billing] = await tx.$queryRaw<
        { paid_cents: number; overdue_count: number; overdue_cents: number }[]
      >`
        SELECT COALESCE(SUM(i.amount_cents) FILTER (WHERE i.status = 'PAID' AND i.paid_at >= ${from} AND i.paid_at < ${to}), 0)::int AS paid_cents,
               COUNT(*) FILTER (WHERE i.status = 'OVERDUE')::int AS overdue_count,
               COALESCE(SUM(i.amount_cents) FILTER (WHERE i.status = 'OVERDUE'), 0)::int AS overdue_cents
          FROM invoices i
          JOIN tenants t ON t.id = i.tenant_id
          JOIN plans p ON p.id = t.plan_id
         WHERE true ${tenantFilter}`;

      const daily = await tx.$queryRaw<{ date: string; completed: number; gmv_cents: number }[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS date,
               COUNT(b.id)::int AS completed,
               COALESCE(SUM(b.total_price_cents), 0)::int AS gmv_cents
          FROM generate_series(${query.from}::date, ${query.to}::date, interval '1 day') AS day
          LEFT JOIN (
            SELECT b.* FROM bookings b
              JOIN tenants t ON t.id = b.tenant_id
              JOIN plans p ON p.id = t.plan_id
             WHERE b.status = 'COMPLETED' AND b.starts_at >= ${from} AND b.starts_at < ${to} ${tenantFilter}
          ) b ON (b.starts_at AT TIME ZONE 'America/Sao_Paulo')::date = day::date
         GROUP BY day
         ORDER BY day`;

      const top = await tx.$queryRaw<
        {
          id: string;
          display_name: string;
          status: string;
          plan: string;
          completed: number;
          gmv_cents: number;
        }[]
      >`
        SELECT t.id, t.display_name, t.status::text AS status, p.name AS plan,
               COUNT(b.id) FILTER (WHERE b.status = 'COMPLETED')::int AS completed,
               COALESCE(SUM(b.total_price_cents) FILTER (WHERE b.status = 'COMPLETED'), 0)::int AS gmv_cents
          FROM tenants t
          JOIN plans p ON p.id = t.plan_id
          LEFT JOIN bookings b ON b.tenant_id = t.id AND b.starts_at >= ${from} AND b.starts_at < ${to}
         WHERE t.deleted_at IS NULL ${tenantFilter}
         GROUP BY t.id, t.display_name, t.status, p.name
         ORDER BY gmv_cents DESC
         LIMIT 10`;

      return {
        from: query.from,
        to: query.to,
        tenants: {
          total: overview?.total ?? 0,
          byStatus: {
            TRIAL: overview?.trial ?? 0,
            ACTIVE: overview?.active ?? 0,
            PAST_DUE: overview?.past_due ?? 0,
            BLOCKED: overview?.blocked ?? 0,
            CANCELED: overview?.canceled ?? 0,
          },
          mrrCents: overview?.mrr_cents ?? 0,
          newInPeriod: overview?.new_in_period ?? 0,
        },
        bookings: {
          completed: bookings?.completed ?? 0,
          gmvCents: bookings?.gmv_cents ?? 0,
          canceled: bookings?.canceled ?? 0,
          noShow: bookings?.no_show ?? 0,
          bySource: {
            PUBLIC: bookings?.from_public ?? 0,
            WHATSAPP: bookings?.from_whatsapp ?? 0,
            PANEL: bookings?.from_panel ?? 0,
          },
        },
        billing: {
          paidCents: billing?.paid_cents ?? 0,
          overdueCount: billing?.overdue_count ?? 0,
          overdueCents: billing?.overdue_cents ?? 0,
        },
        daily: daily.map((row) => ({
          date: row.date,
          completedBookings: row.completed,
          gmvCents: row.gmv_cents,
        })),
        topTenants: top.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          status: row.status,
          plan: row.plan,
          completedBookings: row.completed,
          gmvCents: row.gmv_cents,
        })),
      };
    });
  }

  async listUsers(input: ListUsersInput) {
    const users = await this.prisma.asSystem((tx) =>
      tx.user.findMany({
        where: input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: 'insensitive' } },
                { email: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : undefined,
        select: userSelect,
        orderBy: [{ isPlatformAdmin: 'desc' }, { name: 'asc' }],
        take: 200,
      }),
    );
    return users.map((user) => this.present(user));
  }

  async createUser(input: CreateUserInput) {
    const passwordHash = await hash(input.password);
    try {
      const user = await this.prisma.asSystem((tx) =>
        tx.user.create({
          data: {
            name: input.name,
            email: input.email.toLowerCase(),
            passwordHash,
            isPlatformAdmin: input.isPlatformAdmin,
          },
          select: userSelect,
        }),
      );
      return this.present(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict('EMAIL_TAKEN', 'This email is already registered');
      }
      throw error;
    }
  }

  async updateUser(actorId: string, id: string, input: UpdateUserInput) {
    if (actorId === id && (input.isPlatformAdmin === false || input.active === false)) {
      throw AppError.conflict('CANNOT_DEMOTE_SELF', 'You cannot remove your own access');
    }
    const user = await this.prisma.asSystem(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, select: { id: true } });
      if (!existing) {
        throw AppError.notFound('USER_NOT_FOUND', 'User not found');
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          isPlatformAdmin: input.isPlatformAdmin,
          deletedAt: input.active === undefined ? undefined : input.active ? null : new Date(),
        },
        select: userSelect,
      });
      if (input.active === false || input.isPlatformAdmin === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return updated;
    });
    return this.present(user);
  }

  private present(user: Prisma.UserGetPayload<{ select: typeof userSelect }>) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      active: user.deletedAt === null,
      memberships: user.memberships.map((item) => ({
        tenantId: item.tenant.id,
        tenant: item.tenant.displayName,
        role: item.role.name,
      })),
    };
  }
}
