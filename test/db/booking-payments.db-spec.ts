import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import request from 'supertest';
import { PERMISSIONS } from '../../src/modules/access/permissions';
import { addDays, localDateOf, weekdayOf } from '../../src/modules/availability/zoned-time';
import { signPayload } from '../../src/modules/integrations/webhook-dispatcher.service';
import { createTestApp, type TestApp } from '../support/app';
import { FAKE_WEBHOOK_TOKEN } from '../support/fakes';

type Received = { headers: Record<string, string | string[] | undefined>; body: string };

describe('booking payments and outbound webhooks', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `pag-${randomUUID().slice(0, 8)}`;
  const date = addDays(localDateOf(new Date(), 'America/Sao_Paulo'), 5);
  let tenantId = '';
  let unitId = '';
  let staffId = '';
  let corte = '';
  let auth: { Authorization: string };
  let adminAuth: { Authorization: string };
  let hookServer: Server;
  let hookUrl = '';
  const received: Received[] = [];

  const server = () => ctx.app.getHttpServer();

  const book = async (time: string) => {
    const slots = await request(server())
      .get('/v1/availability')
      .query({ unitId, date, serviceIds: corte, staffId })
      .set(auth)
      .expect(200);
    const slot = (slots.body as { slots: { time: string; startsAt: string }[] }).slots.find(
      (item) => item.time === time,
    );
    const hold = await request(server())
      .post('/v1/bookings/holds')
      .set(auth)
      .send({ unitId, serviceIds: [corte], staffId, startsAt: slot?.startsAt })
      .expect(201);
    const confirmed = await request(server())
      .post(`/v1/bookings/${hold.body.id}/confirm`)
      .set(auth)
      .send({ customer: { name: 'Cliente Pix', phone: '38995556666' } })
      .expect(200);
    return confirmed.body.id as string;
  };

  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    await db.connect();
    hookServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;

    ctx = await createTestApp();
    adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Pagamentos LTDA',
        displayName: 'Barbearia Pix',
        email: 'pix@teste.com',
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
      .send({ slotIntervalMinutes: 30, minAdvanceMinutes: 0 })
      .expect(200);
    corte = (
      await request(server())
        .post('/v1/services')
        .set(auth)
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
    ).body.id as string;
    const staff = await request(server())
      .post('/v1/staff')
      .set(auth)
      .send({ name: 'Rafa', unitIds: [unitId] });
    staffId = staff.body.id as string;
    await request(server())
      .put(`/v1/staff/${staffId}/working-hours`)
      .set(auth)
      .send({ intervals: [{ unitId, weekday: weekdayOf(date), start: '09:00', end: '12:00' }] })
      .expect(204);
  });

  afterAll(async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM webhook_endpoints WHERE url = $1`, [hookUrl]);
    await db.query(`DELETE FROM idempotency_keys WHERE tenant_id = $1`, [tenantId]);
    await db.query(`DELETE FROM bookings WHERE tenant_id = $1`, [tenantId]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await db.query('COMMIT');
    await db.end();
    await ctx.app.close();
    hookServer.close();
  });

  it('creates a deposit link, reuses it and settles it from the provider webhook', async () => {
    await request(server())
      .put('/v1/payment-settings')
      .set(auth)
      .send({ depositPercent: 40 })
      .expect(200);
    const bookingId = await book('09:00');

    const first = await request(server())
      .post(`/v1/bookings/${bookingId}/payment-link`)
      .set(auth)
      .send({ kind: 'DEPOSIT' })
      .expect(201);
    expect(first.body.reused).toBe(false);
    expect(first.body.payment.amountCents).toBe(2000);
    expect(first.body.payment.paymentUrl).toMatch(/^https:\/\/sandbox\.test\/c\//);

    const again = await request(server())
      .post(`/v1/bookings/${bookingId}/payment-link`)
      .set(auth)
      .send({ kind: 'DEPOSIT' })
      .expect(201);
    expect(again.body.reused).toBe(true);
    expect(again.body.payment.id).toBe(first.body.payment.id);

    const link = ctx.payments.links.at(-1);
    await request(server())
      .post('/v1/webhooks/asaas')
      .set('asaas-access-token', FAKE_WEBHOOK_TOKEN)
      .send({
        id: `evt_${randomUUID()}`,
        event: 'PAYMENT_RECEIVED',
        payment: { id: `pay_${randomUUID()}`, paymentLink: link?.id },
      })
      .expect(200);

    const summary = await request(server())
      .get(`/v1/bookings/${bookingId}/payments`)
      .set(auth)
      .expect(200);
    expect(summary.body.paidCents).toBe(2000);
    expect(summary.body.dueCents).toBe(3000);
    expect(summary.body.payments[0].status).toBe('PAID');

    const full = await request(server())
      .post(`/v1/bookings/${bookingId}/payment-link`)
      .set(auth)
      .send({ kind: 'FULL' })
      .expect(409);
    expect(full.body.code).toBe('ALREADY_PAID');

    const remainder = await request(server())
      .post(`/v1/bookings/${bookingId}/payment-link`)
      .set(auth)
      .send({ kind: 'REMAINDER' })
      .expect(201);
    expect(remainder.body.payment.amountCents).toBe(3000);
  });

  it('lets the admin keep api settings with masked secrets', async () => {
    await request(server())
      .put('/v1/admin/integrations/n8n')
      .set(adminAuth)
      .send({ baseUrl: 'https://n8n.example.com', apiKey: 'n8n-secret-9876' })
      .expect(200);
    await request(server())
      .put('/v1/admin/integrations/n8n')
      .set(adminAuth)
      .send({ baseUrl: 'https://n8n.example.com', apiKey: '' })
      .expect(200);
    const list = await request(server()).get('/v1/admin/integrations').set(adminAuth).expect(200);
    expect(list.body.integrations.n8n.baseUrl).toBe('https://n8n.example.com');
    expect(list.body.integrations.n8n.apiKey).toEqual({ set: true, hint: '••••9876' });
    expect(JSON.stringify(list.body)).not.toContain('n8n-secret-9876');

    await request(server()).get('/v1/admin/integrations').set(auth).expect(403);
  });

  it('keeps integration settings for each barbershop', async () => {
    await request(server())
      .put(`/v1/admin/tenants/${tenantId}/integrations/whatsapp`)
      .set(adminAuth)
      .send({ phoneNumberId: '1234567890', accessToken: 'EAAG-secret-token-4321' })
      .expect(200);
    const listed = await request(server())
      .get(`/v1/admin/tenants/${tenantId}/integrations`)
      .set(adminAuth)
      .expect(200);
    expect(listed.body.whatsapp.values).toEqual({
      phoneNumberId: '1234567890',
      accessToken: { set: true, hint: '••••4321' },
    });
    expect(listed.body.asaas).toEqual({ depositPercent: 40, ownAccount: false });
    expect(JSON.stringify(listed.body)).not.toContain('EAAG-secret');

    await request(server())
      .put(`/v1/admin/tenants/${tenantId}/integrations/google`)
      .set(adminAuth)
      .send({ calendarId: 'agenda@group.calendar.google.com' })
      .expect(200);
    const tested = await request(server())
      .post(`/v1/admin/tenants/${tenantId}/integrations/google/test`)
      .set(adminAuth)
      .expect(200);
    expect(tested.body.ok).toBe(true);
    await request(server())
      .put(`/v1/admin/tenants/${tenantId}/integrations/whatsapp`)
      .set(auth)
      .send({ phoneNumberId: '1' })
      .expect(403);
  });

  it('signs and delivers booking events to registered endpoints', async () => {
    const created = await request(server())
      .post('/v1/admin/webhooks')
      .set(adminAuth)
      .send({
        name: 'Automação',
        url: hookUrl,
        events: ['booking.confirmed', 'booking.canceled'],
        tenantId,
      })
      .expect(201);
    const secret = created.body.secret as string;
    expect(secret).toMatch(/^whsec_/);

    const listed = await request(server()).get('/v1/admin/webhooks').set(adminAuth).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(secret);

    const bookingId = await book('10:00');
    await waitFor(() => received.length > 0);
    const delivery = received[0];
    expect(delivery?.headers['x-chegai-event']).toBe('booking.confirmed');
    const timestamp = delivery?.headers['x-chegai-timestamp'] as string;
    expect(delivery?.headers['x-chegai-signature']).toBe(
      `sha256=${signPayload(secret, timestamp, delivery?.body ?? '')}`,
    );
    expect(JSON.parse(delivery?.body ?? '{}').data.id).toBe(bookingId);

    await waitFor(() => false);
    const log = await request(server())
      .get(`/v1/admin/webhooks/${created.body.id}/deliveries`)
      .set(adminAuth)
      .expect(200);
    expect(log.body[0]).toMatchObject({ event: 'booking.confirmed', ok: true, statusCode: 204 });

    await request(server())
      .post('/v1/admin/webhooks')
      .set(adminAuth)
      .send({ name: 'Ruim', url: 'ftp://example.com', events: ['booking.confirmed'] })
      .expect(400);
  });
});
