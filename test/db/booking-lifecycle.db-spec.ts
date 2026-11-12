import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/modules/access/permissions';
import { addDays, localDateOf, weekdayOf } from '../../src/modules/availability/zoned-time';
import { BookingsSweeper } from '../../src/modules/bookings/bookings.sweeper';
import { createTestApp, type TestApp } from '../support/app';

type Booking = { id: string; status: string; startsAt: string; staff: { id: string } };
type BookingEvent = { fromStatus: string | null; toStatus: string; reason: string | null };
type SlotsBody = { slots: { time: string; startsAt: string }[] };

const timesOf = (body: unknown) => (body as SlotsBody).slots.map((slot) => slot.time);

describe('booking lifecycle', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `ciclo-${randomUUID().slice(0, 8)}`;
  const date = addDays(localDateOf(new Date(), 'America/Sao_Paulo'), 4);
  const barberUserId = randomUUID();
  let tenantId = '';
  let unitId = '';
  let joao = '';
  let pedro = '';
  let corte = '';
  let auth: { Authorization: string };
  let barberAuth: { Authorization: string };

  const server = () => ctx.app.getHttpServer();

  const startOf = async (time: string, staffId: string) => {
    const response = await request(server())
      .get('/v1/availability')
      .query({ unitId, date, serviceIds: corte, staffId })
      .set(auth)
      .expect(200);
    const slot = (response.body as SlotsBody).slots.find((item) => item.time === time);
    if (!slot) {
      throw new Error(`slot ${time} not offered`);
    }
    return slot.startsAt;
  };

  const book = async (time: string, staffId = joao) => {
    const hold = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .send({ unitId, serviceIds: [corte], staffId, startsAt: await startOf(time, staffId) })
      .expect(201);
    const confirmed = await request(server())
      .post(`/v1/bookings/${hold.body.id}/confirm`)
      .set(auth)
      .send({ customer: { name: 'Cliente Ciclo', phone: '38991112222' } })
      .expect(200);
    return confirmed.body as Booking;
  };

  const moveTo = async (bookingId: string, startsAt: Date) => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(
      `UPDATE bookings
          SET starts_at = $2, ends_at = $2::timestamptz + interval '30 minutes',
              blocked_until = $2::timestamptz + interval '30 minutes'
        WHERE id = $1`,
      [bookingId, startsAt],
    );
    await db.query('COMMIT');
  };

  beforeAll(async () => {
    await db.connect();
    ctx = await createTestApp();
    const adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };

    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Ciclo LTDA',
        displayName: 'Ciclo',
        email: 'ciclo@teste.com',
        planCode: 'PROFISSIONAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
    auth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };

    unitId = (await request(server()).get('/v1/units').set(auth)).body[0].id as string;
    await request(server())
      .patch(`/v1/units/${unitId}`)
      .set(auth)
      .send({ slotIntervalMinutes: 30, minAdvanceMinutes: 0, noShowAfterMinutes: 30 })
      .expect(200);

    corte = (
      await request(server())
        .post('/v1/services')
        .set(auth)
        .send({ name: 'Corte', priceCents: 4000, durationMinutes: 30 })
    ).body.id as string;

    for (const name of ['João', 'Pedro']) {
      const staff = await request(server())
        .post('/v1/staff')
        .set(auth)
        .send({ name, unitIds: [unitId] });
      await request(server())
        .put(`/v1/staff/${staff.body.id}/working-hours`)
        .set(auth)
        .send({ intervals: [{ unitId, weekday: weekdayOf(date), start: '09:00', end: '12:00' }] })
        .expect(204);
      if (name === 'João') joao = staff.body.id as string;
      else pedro = staff.body.id as string;
    }

    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(`UPDATE staff SET user_id = $1 WHERE id = $2`, [barberUserId, pedro]);
    await db.query('COMMIT');

    const barber = SYSTEM_ROLES.find((role) => role.key === 'BARBER');
    barberAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({
        sub: barberUserId,
        tid: tenantId,
        role: 'BARBER',
        perms: [...(barber?.permissions ?? [])],
      })}`,
    };
  });

  afterAll(async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM idempotency_keys WHERE tenant_id = $1`, [tenantId]);
    await db.query(`DELETE FROM bookings WHERE tenant_id = $1`, [tenantId]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await db.query('COMMIT');
    await db.end();
    await ctx.app.close();
  });

  it('reschedules to a free time and records the history', async () => {
    const booking = await book('09:00');
    const target = await startOf('10:00', joao);

    const moved = await request(server())
      .post(`/v1/bookings/${booking.id}/reschedule`)
      .set(auth)
      .send({ startsAt: target })
      .expect(200);
    expect(new Date(moved.body.startsAt as string).toISOString()).toBe(
      new Date(target).toISOString(),
    );

    const free = await request(server())
      .get('/v1/availability')
      .query({ unitId, date, serviceIds: corte, staffId: joao })
      .set(auth);
    expect(timesOf(free.body)).toContain('09:00');
    expect(timesOf(free.body)).not.toContain('10:00');

    const events = await request(server())
      .get(`/v1/bookings/${booking.id}/events`)
      .set(auth)
      .expect(200);
    expect((events.body as BookingEvent[]).map((event) => [event.toStatus, event.reason])).toEqual([
      ['HOLD', null],
      ['CONFIRMED', null],
      ['CONFIRMED', 'RESCHEDULED'],
    ]);
  });

  it('refuses to reschedule onto a taken time', async () => {
    const first = await book('11:00');
    const second = await book('11:30');

    const response = await request(server())
      .post(`/v1/bookings/${second.id}/reschedule`)
      .set(auth)
      .send({ startsAt: first.startsAt })
      .expect(409);
    expect(response.body.code).toBe('SLOT_UNAVAILABLE');
  });

  it('cancels once and frees the time', async () => {
    const booking = await book('09:00', pedro);

    const canceled = await request(server())
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set(auth)
      .send({ reason: 'Cliente pediu' })
      .expect(200);
    expect(canceled.body.status).toBe('CANCELED');
    expect(canceled.body.cancelReason).toBe('Cliente pediu');

    const again = await request(server())
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set(auth)
      .send({})
      .expect(409);
    expect(again.body.code).toBe('BOOKING_NOT_CANCELABLE');

    await startOf('09:00', pedro);
  });

  it('checks in, completes and refuses early check-in', async () => {
    const booking = await book('09:30', pedro);

    const early = await request(server())
      .post(`/v1/bookings/${booking.id}/check-in`)
      .set(auth)
      .expect(409);
    expect(early.body.code).toBe('CHECK_IN_TOO_EARLY');

    await moveTo(booking.id, new Date(Date.now() + 10 * 60000));

    const checkedIn = await request(server())
      .post(`/v1/bookings/${booking.id}/check-in`)
      .set(auth)
      .expect(200);
    expect(checkedIn.body.status).toBe('CHECKED_IN');
    expect(checkedIn.body.checkedInAt).toBeTruthy();

    const completed = await request(server())
      .post(`/v1/bookings/${booking.id}/complete`)
      .set(auth)
      .expect(200);
    expect(completed.body.status).toBe('COMPLETED');

    const events = await request(server()).get(`/v1/bookings/${booking.id}/events`).set(auth);
    expect((events.body as BookingEvent[]).map((event) => event.toStatus)).toEqual([
      'HOLD',
      'CONFIRMED',
      'CHECKED_IN',
      'COMPLETED',
    ]);
  });

  it('marks no-shows by hand and automatically, and releases expired holds', async () => {
    const manual = await book('10:00', pedro);
    const early = await request(server())
      .post(`/v1/bookings/${manual.id}/no-show`)
      .set(auth)
      .expect(409);
    expect(early.body.code).toBe('BOOKING_NOT_STARTED');

    await moveTo(manual.id, new Date(Date.now() - 5 * 60000));
    const marked = await request(server())
      .post(`/v1/bookings/${manual.id}/no-show`)
      .set(auth)
      .expect(200);
    expect(marked.body.status).toBe('NO_SHOW');

    const automatic = await book('10:30', pedro);
    await moveTo(automatic.id, new Date(Date.now() - 3 * 3600000));

    const hold = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .send({
        unitId,
        serviceIds: [corte],
        staffId: pedro,
        startsAt: await startOf('11:00', pedro),
      })
      .expect(201);
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(
      `UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [hold.body.id],
    );
    await db.query('COMMIT');

    await ctx.app.get(BookingsSweeper).tick();

    const afterSweep = await request(server())
      .get(`/v1/bookings/${automatic.id}`)
      .set(auth)
      .expect(200);
    expect(afterSweep.body.status).toBe('NO_SHOW');
    const expired = await request(server())
      .get(`/v1/bookings/${hold.body.id}`)
      .set(auth)
      .expect(200);
    expect(expired.body.status).toBe('CANCELED');
    expect(expired.body.cancelReason).toBe('HOLD_EXPIRED');

    const events = await request(server()).get(`/v1/bookings/${automatic.id}/events`).set(auth);
    expect((events.body as BookingEvent[]).at(-1)).toMatchObject({
      fromStatus: 'CONFIRMED',
      toStatus: 'NO_SHOW',
      reason: 'AUTOMATIC',
    });
  });

  it('replays a request sent twice with the same Idempotency-Key', async () => {
    const key = `hold-${randomUUID()}`;
    const body = {
      unitId,
      serviceIds: [corte],
      staffId: joao,
      startsAt: await startOf('09:30', joao),
    };

    const first = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const second = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const reused = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ ...body, staffId: pedro })
      .expect(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const invalid = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .set('Idempotency-Key', 'x')
      .send(body)
      .expect(400);
    expect(invalid.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('lists the agenda and lets a barber see only their own bookings', async () => {
    const from = new Date(Date.now() - 864e5).toISOString();
    const to = new Date(Date.now() + 10 * 864e5).toISOString();

    const all = await request(server())
      .get('/v1/bookings')
      .query({ from, to })
      .set(auth)
      .expect(200);
    const staffIds = new Set((all.body as Booking[]).map((booking) => booking.staff.id));
    expect(staffIds).toEqual(new Set([joao, pedro]));
    expect((all.body as Booking[]).every((booking) => booking.status !== 'HOLD')).toBe(true);

    const own = await request(server())
      .get('/v1/bookings')
      .query({ from, to })
      .set(barberAuth)
      .expect(200);
    expect((own.body as Booking[]).length).toBeGreaterThan(0);
    expect((own.body as Booking[]).every((booking) => booking.staff.id === pedro)).toBe(true);

    const joaoBooking = (all.body as Booking[]).find((booking) => booking.staff.id === joao);
    await request(server()).get(`/v1/bookings/${joaoBooking?.id}`).set(barberAuth).expect(404);
  });
});
