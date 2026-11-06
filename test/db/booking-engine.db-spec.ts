import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { PERMISSIONS } from '../../src/modules/access/permissions';
import { addDays, localDateOf, weekdayOf } from '../../src/modules/availability/zoned-time';
import { createTestApp, type TestApp } from '../support/app';

type SlotsBody = { slots: { time: string }[] };

const timesOf = (body: unknown) => (body as SlotsBody).slots.map((slot) => slot.time);

describe('availability and holds', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `agenda-${randomUUID().slice(0, 8)}`;
  const date = addDays(localDateOf(new Date(), 'America/Sao_Paulo'), 3);
  let tenantId = '';
  let unitId = '';
  let joao = '';
  let pedro = '';
  let corte = '';
  let barba = '';
  let auth: { Authorization: string };

  const server = () => ctx.app.getHttpServer();

  beforeAll(async () => {
    await db.connect();
    ctx = await createTestApp();
    const adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };

    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Agenda LTDA',
        displayName: 'Agenda',
        email: 'agenda@teste.com',
        planCode: 'PROFISSIONAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
    auth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };

    const units = await request(server()).get('/v1/units').set(auth);
    unitId = units.body[0].id as string;
    await request(server())
      .patch(`/v1/units/${unitId}`)
      .set(auth)
      .send({ slotIntervalMinutes: 30, minAdvanceMinutes: 0 });

    corte = (
      await request(server())
        .post('/v1/services')
        .set(auth)
        .send({ name: 'Corte', priceCents: 4000, durationMinutes: 30, bufferMinutes: 10 })
    ).body.id as string;
    barba = (
      await request(server())
        .post('/v1/services')
        .set(auth)
        .send({ name: 'Barba', priceCents: 3000, durationMinutes: 20 })
    ).body.id as string;

    const weekday = weekdayOf(date);
    for (const name of ['João', 'Pedro']) {
      const staff = await request(server())
        .post('/v1/staff')
        .set(auth)
        .send({ name, unitIds: [unitId] });
      await request(server())
        .put(`/v1/staff/${staff.body.id}/working-hours`)
        .set(auth)
        .send({ intervals: [{ unitId, weekday, start: '09:00', end: '11:00' }] })
        .expect(204);
      if (name === 'João') joao = staff.body.id as string;
      else pedro = staff.body.id as string;
    }

    await request(server())
      .put(`/v1/staff/${pedro}/services`)
      .set(auth)
      .send({ services: [{ serviceId: corte, priceCents: 5000 }] })
      .expect(204);
  });

  afterAll(async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM bookings WHERE tenant_id = $1`, [tenantId]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await db.query('COMMIT');
    await db.end();
    await ctx.app.close();
  });

  const availability = (serviceIds: string[], staffId?: string) =>
    request(server())
      .get('/v1/availability')
      .query({ unitId, date, serviceIds: serviceIds.join(','), staffId })
      .set(auth)
      .expect(200);

  it('lists the free times with the barbers who can do the services', async () => {
    const response = await availability([corte]);

    expect(timesOf(response.body)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    const first = response.body.slots[0].staff as { id: string; priceCents: number }[];
    expect(first.find((staff) => staff.id === pedro)?.priceCents).toBe(5000);
    expect(first.find((staff) => staff.id === joao)?.priceCents).toBe(4000);
  });

  it('only offers a combo with barbers that do every service', async () => {
    const response = await availability([corte, barba]);
    const staffIds = new Set(
      (response.body.slots as { staff: { id: string }[] }[]).flatMap((slot) =>
        slot.staff.map((s) => s.id),
      ),
    );

    expect([...staffIds]).toEqual([joao]);
    expect(timesOf(response.body)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('lets only one of two simultaneous requests take the same slot', async () => {
    const slots = (await availability([corte], joao)).body.slots as { startsAt: string }[];
    const body = { unitId, serviceIds: [corte], staffId: joao, startsAt: slots[0].startsAt };

    const results = await Promise.all([
      request(server()).post('/v1/bookings/holds').set(auth).send(body),
      request(server()).post('/v1/bookings/holds').set(auth).send(body),
    ]);
    const statuses = results.map((result) => result.status).sort();

    expect(statuses).toEqual([201, 409]);
    const loser = results.find((result) => result.status === 409);
    expect(['SLOT_TAKEN', 'SLOT_UNAVAILABLE']).toContain(loser?.body.code);

    const after = await availability([corte], joao);
    expect(timesOf(after.body)).toEqual(['10:00', '10:30']);
  });

  it('confirms a hold and creates the customer by phone', async () => {
    const slots = (await availability([corte], pedro)).body.slots as { startsAt: string }[];
    const hold = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .send({ unitId, serviceIds: [corte], staffId: pedro, startsAt: slots[0].startsAt })
      .expect(201);

    expect(hold.body.status).toBe('HOLD');
    expect(hold.body.totalPriceCents).toBe(5000);

    const confirmed = await request(server())
      .post(`/v1/bookings/${hold.body.id}/confirm`)
      .set(auth)
      .send({ customer: { name: 'Cliente Teste', phone: '(38) 98888-1111' } })
      .expect(200);

    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.customer.phone).toBe('+5538988881111');
  });

  it('rejects confirming an expired hold and frees its slot', async () => {
    const slots = (await availability([barba], joao)).body.slots as {
      startsAt: string;
      time: string;
    }[];
    const target = slots.find((slot) => slot.time === '10:30');
    const hold = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .send({ unitId, serviceIds: [barba], staffId: joao, startsAt: target?.startsAt })
      .expect(201);

    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(
      `UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [hold.body.id],
    );
    await db.query('COMMIT');

    const expired = await request(server())
      .post(`/v1/bookings/${hold.body.id}/confirm`)
      .set(auth)
      .send({ customer: { name: 'Atrasado', phone: '38977776666' } })
      .expect(410);
    expect(expired.body.code).toBe('HOLD_EXPIRED');

    await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .send({ unitId, serviceIds: [barba], staffId: joao, startsAt: target?.startsAt })
      .expect(201);
  });
});
