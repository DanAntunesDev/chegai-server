import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { PERMISSIONS } from '../../src/modules/access/permissions';
import { addDays, localDateOf, weekdayOf } from '../../src/modules/availability/zoned-time';
import { createTestApp, type TestApp } from '../support/app';

type SlotsBody = { slots: { time: string; startsAt: string }[] };

describe('public booking', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `publica-${randomUUID().slice(0, 8)}`;
  const otherSlug = `outra-${randomUUID().slice(0, 8)}`;
  const date = addDays(localDateOf(new Date(), 'America/Sao_Paulo'), 2);
  const phone = '38991234567';
  const normalized = '+5538991234567';
  const tenantIds: string[] = [];
  let unitId = '';
  let barber = '';
  let corte = '';
  let ownerAuth: { Authorization: string };

  const server = () => ctx.app.getHttpServer();
  const base = `/v1/public/tenants/${slug}`;

  const createTenant = async (tenantSlug: string) => {
    const adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug: tenantSlug,
        legalName: 'Publica LTDA',
        displayName: 'Barbearia Pública',
        email: 'publica@teste.com',
        planCode: 'PROFISSIONAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${tenantSlug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    const id = created.body.tenant.id as string;
    tenantIds.push(id);
    return id;
  };

  const verifiedToken = async (tenantSlug = slug) => {
    await request(server())
      .post(`/v1/public/tenants/${tenantSlug}/verification/request`)
      .send({ phone })
      .expect(202);
    const code = ctx.messenger.lastCodeFor(normalized);
    const verified = await request(server())
      .post(`/v1/public/tenants/${tenantSlug}/verification/confirm`)
      .send({ phone, code })
      .expect(200);
    return `Bearer ${verified.body.token as string}`;
  };

  const firstSlot = async () => {
    const response = await request(server())
      .get(`${base}/availability`)
      .query({ unitId, date, serviceIds: corte })
      .expect(200);
    return (response.body as SlotsBody).slots[0].startsAt;
  };

  const clearCodes = async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM phone_verifications WHERE tenant_id = ANY($1::uuid[])`, [
      tenantIds,
    ]);
    await db.query('COMMIT');
  };

  beforeAll(async () => {
    await db.connect();
    ctx = await createTestApp();
    const tenantId = await createTenant(slug);
    await createTenant(otherSlug);
    ownerAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };

    unitId = (await request(server()).get('/v1/units').set(ownerAuth)).body[0].id as string;
    await request(server())
      .patch(`/v1/units/${unitId}`)
      .set(ownerAuth)
      .send({ slotIntervalMinutes: 30, minAdvanceMinutes: 0 })
      .expect(200);
    corte = (
      await request(server())
        .post('/v1/services')
        .set(ownerAuth)
        .send({ name: 'Corte', priceCents: 4500, durationMinutes: 30 })
    ).body.id as string;
    barber = (
      await request(server())
        .post('/v1/staff')
        .set(ownerAuth)
        .send({ name: 'Marcos', nickname: 'Marquinhos', unitIds: [unitId] })
    ).body.id as string;
    await request(server())
      .put(`/v1/staff/${barber}/working-hours`)
      .set(ownerAuth)
      .send({ intervals: [{ unitId, weekday: weekdayOf(date), start: '09:00', end: '12:00' }] })
      .expect(204);
  });

  afterEach(clearCodes);

  afterAll(async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM idempotency_keys WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    await db.query(`DELETE FROM bookings WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    await db.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds]);
    await db.query('COMMIT');
    await db.end();
    await ctx.app.close();
  });

  it('shows the barbershop, its catalog and free times without login', async () => {
    const profile = await request(server()).get(base).expect(200);
    expect(profile.body.displayName).toBe('Barbearia Pública');
    expect(profile.body.units[0].id).toBe(unitId);
    expect(profile.body.branding.primaryColor).toMatch(/^#/);

    const catalog = await request(server()).get(`${base}/catalog`).expect(200);
    expect(catalog.body.services[0]).toMatchObject({ id: corte, priceCents: 4500 });
    expect(catalog.body.staff[0]).toMatchObject({
      id: barber,
      name: 'Marquinhos',
      serviceIds: [corte],
    });
    expect(catalog.body.staff[0]).not.toHaveProperty('phone');

    const slots = await request(server())
      .get(`${base}/availability`)
      .query({ unitId, date, serviceIds: corte })
      .expect(200);
    expect((slots.body as SlotsBody).slots.map((slot) => slot.time)).toContain('09:00');

    await request(server())
      .get(`/v1/public/tenants/nao-existe-${randomUUID().slice(0, 6)}`)
      .expect(404);
  });

  it('books end to end with a verified phone and lets the customer cancel', async () => {
    const hold = await request(server())
      .post(`${base}/bookings/holds`)
      .send({ unitId, serviceIds: [corte], startsAt: await firstSlot() })
      .expect(201);
    expect(hold.body.status).toBe('HOLD');
    expect(hold.body).not.toHaveProperty('customer');

    await request(server())
      .post(`${base}/bookings/${hold.body.id}/confirm`)
      .send({ name: 'João Cliente' })
      .expect(401);

    await request(server()).post(`${base}/verification/request`).send({ phone }).expect(202);
    const wrong = await request(server())
      .post(`${base}/verification/confirm`)
      .send({
        phone,
        code: ctx.messenger.lastCodeFor(normalized) === '000000' ? '111111' : '000000',
      })
      .expect(400);
    expect(wrong.body.code).toBe('INVALID_CODE');

    const verified = await request(server())
      .post(`${base}/verification/confirm`)
      .send({ phone, code: ctx.messenger.lastCodeFor(normalized) })
      .expect(200);
    const customerAuth = { Authorization: `Bearer ${verified.body.token as string}` };

    const confirmed = await request(server())
      .post(`${base}/bookings/${hold.body.id}/confirm`)
      .set(customerAuth)
      .send({ name: 'João Cliente' })
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.staff.name).toBe('Marquinhos');

    const customers = await request(server()).get('/v1/customers').set(ownerAuth).expect(200);
    expect(JSON.stringify(customers.body)).toContain(normalized);

    const mine = await request(server()).get(`${base}/bookings`).set(customerAuth).expect(200);
    expect((mine.body as { id: string }[]).map((booking) => booking.id)).toEqual([hold.body.id]);

    const canceled = await request(server())
      .post(`${base}/bookings/${hold.body.id}/cancel`)
      .set(customerAuth)
      .expect(200);
    expect(canceled.body.status).toBe('CANCELED');

    const events = await request(server())
      .get(`/v1/bookings/${hold.body.id}/events`)
      .set(ownerAuth);
    expect((events.body as { reason: string | null }[]).map((event) => event.reason)).toEqual([
      null,
      'CUSTOMER',
      'CUSTOMER',
    ]);
  });

  it('keeps customer tokens and panel tokens apart', async () => {
    const customerToken = await verifiedToken();
    await request(server()).get('/v1/units').set('Authorization', customerToken).expect(401);
    await request(server()).get(`${base}/bookings`).set(ownerAuth).expect(401);
    await request(server())
      .get(`/v1/public/tenants/${otherSlug}/bookings`)
      .set('Authorization', customerToken)
      .expect(401);
  });

  it('limits how many codes a phone can request', async () => {
    for (let index = 0; index < 3; index++) {
      await request(server()).post(`${base}/verification/request`).send({ phone }).expect(202);
    }
    const blocked = await request(server())
      .post(`${base}/verification/request`)
      .send({ phone })
      .expect(429);
    expect(blocked.body.code).toBe('TOO_MANY_CODES');
  });

  it('throttles repeated attempts per client', async () => {
    process.env.THROTTLE_IN_TESTS = 'true';
    try {
      const statuses: number[] = [];
      for (let index = 0; index < 12; index++) {
        const response = await request(server())
          .post(`${base}/verification/confirm`)
          .send({ phone, code: '123456' });
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      delete process.env.THROTTLE_IN_TESTS;
    }
  });

  it('sends security headers', async () => {
    const response = await request(server()).get('/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
