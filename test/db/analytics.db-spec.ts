import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { setupOpenApi } from '../../src/docs/openapi';
import { PERMISSIONS } from '../../src/modules/access/permissions';
import { createTestApp, type TestApp } from '../support/app';

describe('analytics and api docs', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `numeros-${randomUUID().slice(0, 8)}`;
  let tenantId = '';
  let unitId = '';
  let staffId = '';
  let serviceId = '';
  let ownerAuth: { Authorization: string };

  const server = () => ctx.app.getHttpServer();

  const insertBooking = async (startsAt: string, status: string, priceCents: number) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO bookings (id, tenant_id, unit_id, staff_id, status, source, starts_at, ends_at,
         blocked_until, total_price_cents, updated_at)
       VALUES ($1, $2, $3, $4, $5::"BookingStatus", 'PANEL', $6::timestamptz,
         $6::timestamptz + interval '30 minutes', $6::timestamptz + interval '30 minutes', $7, now())`,
      [id, tenantId, unitId, staffId, status, startsAt, priceCents],
    );
  };

  beforeAll(async () => {
    await db.connect();
    await db.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
    ctx = await createTestApp();
    const adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Números LTDA',
        displayName: 'Números',
        email: 'numeros@teste.com',
        planCode: 'PROFISSIONAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
    ownerAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };
    unitId = (await request(server()).get('/v1/units').set(ownerAuth)).body[0].id as string;
    staffId = (
      await request(server())
        .post('/v1/staff')
        .set(ownerAuth)
        .send({ name: 'Rafa', unitIds: [unitId] })
    ).body.id as string;
    serviceId = (
      await request(server())
        .post('/v1/services')
        .set(ownerAuth)
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
    ).body.id as string;
    await request(server())
      .put(`/v1/staff/${staffId}/working-hours`)
      .set(ownerAuth)
      .send({ intervals: [{ unitId, weekday: 1, start: '09:00', end: '19:00' }] })
      .expect(204);

    await insertBooking('2026-10-05T12:00:00-03:00', 'COMPLETED', 4000);
    await insertBooking('2026-11-02T12:00:00-03:00', 'COMPLETED', 5000);
    await insertBooking('2026-11-09T12:00:00-03:00', 'COMPLETED', 7000);
    await insertBooking('2026-11-16T12:00:00-03:00', 'NO_SHOW', 5000);
    await insertBooking('2026-11-23T12:00:00-03:00', 'CANCELED', 5000);
    expect(serviceId).toBeTruthy();
  });

  afterAll(async () => {
    await db.query(`DELETE FROM bookings WHERE tenant_id = $1`, [tenantId]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await db.end();
    await ctx.app.close();
  });

  it('summarizes the month against the previous one', async () => {
    const started = Date.now();
    const response = await request(server())
      .get('/v1/analytics/summary')
      .query({ month: '2026-11' })
      .set(ownerAuth)
      .expect(200);
    expect(Date.now() - started).toBeLessThan(300);

    expect(response.body.current).toMatchObject({
      revenueCents: 12000,
      completedBookings: 2,
      averageTicketCents: 6000,
      noShowRate: 33.3,
      canceledBookings: 1,
    });
    expect(response.body.current.occupancyRate).toBeCloseTo((60 / (5 * 600)) * 100, 1);
    expect(response.body.previous).toMatchObject({ revenueCents: 4000, completedBookings: 1 });
    expect(response.body.change.revenue).toBe(200);
  });

  it('requires the analytics permission', async () => {
    const barberAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'BARBER', perms: ['bookings.view.own'] })}`,
    };
    await request(server())
      .get('/v1/analytics/summary')
      .query({ month: '2026-11' })
      .set(barberAuth)
      .expect(403);
  });

  it('documents routes with their validation schemas', () => {
    const document = setupOpenApi(ctx.app);
    const hold = document.paths['/v1/bookings/holds']?.post as {
      requestBody?: { content: Record<string, { schema: { required?: string[] } }> };
    };
    expect(hold.requestBody?.content['application/json'].schema.required).toEqual(
      expect.arrayContaining(['unitId', 'serviceIds', 'startsAt']),
    );
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/v1/public/tenants/{slug}/bookings/holds', '/v1/webhooks/asaas']),
    );
  });
});
