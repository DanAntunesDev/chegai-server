import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { PERMISSIONS } from '../../src/modules/access/permissions';
import { BillingService } from '../../src/modules/billing/billing.service';
import { FAKE_WEBHOOK_TOKEN } from '../support/fakes';
import { createTestApp, type TestApp } from '../support/app';

type Invoice = {
  id: string;
  kind: string;
  period: string;
  status: string;
  amountCents: number;
  dueDate: string;
};

describe('billing and blocking', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `cobranca-${randomUUID().slice(0, 8)}`;
  let tenantId = '';
  let ownerAuth: { Authorization: string };
  let adminAuth: { Authorization: string };

  const server = () => ctx.app.getHttpServer();
  const billing = () => ctx.app.get(BillingService);

  const invoices = async () =>
    (await request(server()).get('/v1/tenant/billing').set(ownerAuth).expect(200)).body
      .invoices as Invoice[];

  const statusOf = async () => {
    const result = await db.query<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      tenantId,
    ]);
    return result.rows[0].status;
  };

  const chargeFor = (kind: string) => {
    const charge = ctx.payments.charges.find((item) => item.description.includes(kind));
    if (!charge) {
      throw new Error(`no charge for ${kind}`);
    }
    return charge.id;
  };

  const notify = (event: string, paymentId: string, id = `evt_${randomUUID()}`) =>
    request(server())
      .post('/v1/webhooks/asaas')
      .set('asaas-access-token', FAKE_WEBHOOK_TOKEN)
      .send({ id, event, payment: { id: paymentId } });

  beforeAll(async () => {
    await db.connect();
    await db.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
    ctx = await createTestApp();
    adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Cobrança LTDA',
        displayName: 'Cobrança',
        email: 'financeiro@cobranca.com',
        planCode: 'PROFISSIONAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
    ownerAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };
  });

  afterAll(async () => {
    await db.query(`DELETE FROM payment_webhook_events WHERE payload::text LIKE '%' || $1 || '%'`, [
      tenantId.slice(0, 8),
    ]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await db.end();
    await ctx.app.close();
  });

  it('starts a subscription with setup fee and the first monthly invoice', async () => {
    await billing().startSubscription(
      tenantId,
      { billingDay: 10, chargeSetupFee: true },
      '2026-11-05',
    );

    const list = await invoices();
    expect(list.map((invoice) => [invoice.kind, invoice.period, invoice.amountCents])).toEqual([
      ['MONTHLY', '2026-11', 22900],
      ['SETUP', 'setup', 99000],
    ]);
    expect(list.find((invoice) => invoice.kind === 'SETUP')?.dueDate.slice(0, 10)).toBe(
      '2026-11-09',
    );
    expect(list.find((invoice) => invoice.kind === 'MONTHLY')?.dueDate.slice(0, 10)).toBe(
      '2026-11-10',
    );
    expect(ctx.payments.customers.at(-1)).toMatchObject({ email: 'financeiro@cobranca.com' });

    await billing().runDaily('2026-11-06');
    expect(await invoices()).toHaveLength(2);
  });

  it('activates the barbershop when the setup fee is paid, once per event', async () => {
    const setup = chargeFor('Implantação');
    const eventId = `evt_${tenantId.slice(0, 8)}_setup`;

    await notify('PAYMENT_RECEIVED', setup, eventId).expect(200);
    await notify('PAYMENT_RECEIVED', setup, eventId).expect(200);

    expect(await statusOf()).toBe('ACTIVE');
    expect((await invoices()).find((invoice) => invoice.kind === 'SETUP')?.status).toBe('PAID');
  });

  it('rejects webhooks without the right token', async () => {
    await request(server())
      .post('/v1/webhooks/asaas')
      .set('asaas-access-token', 'wrong')
      .send({ id: 'evt_x', event: 'PAYMENT_RECEIVED', payment: { id: chargeFor('Mensalidade') } })
      .expect(401);
  });

  it('blocks after five business days overdue and unblocks on payment', async () => {
    await billing().runDaily('2026-11-11');
    expect(await statusOf()).toBe('PAST_DUE');
    await request(server()).get('/v1/units').set(ownerAuth).expect(200);

    await billing().runDaily('2026-11-17');
    expect(await statusOf()).toBe('PAST_DUE');

    await billing().runDaily('2026-11-18');
    expect(await statusOf()).toBe('BLOCKED');

    const blocked = await request(server()).get('/v1/units').set(ownerAuth).expect(402);
    expect(blocked.body.code).toBe('TENANT_BLOCKED');
    await request(server()).get('/v1/tenant/billing').set(ownerAuth).expect(200);
    const current = await request(server()).get('/v1/tenant').set(ownerAuth).expect(200);
    expect(current.body.status).toBe('BLOCKED');
    const overdue = (await invoices()).find((invoice) => invoice.status === 'OVERDUE');
    const pix = await request(server())
      .get(`/v1/tenant/billing/invoices/${overdue?.id}/pix`)
      .set(ownerAuth)
      .expect(200);
    expect(pix.body.payload).toMatch(/^pix-/);
    const paid = (await invoices()).find((invoice) => invoice.status === 'PAID');
    await request(server())
      .get(`/v1/tenant/billing/invoices/${paid?.id}/pix`)
      .set(ownerAuth)
      .expect(409);
    await request(server()).get(`/v1/public/tenants/${slug}`).expect(404);

    await notify('PAYMENT_CONFIRMED', chargeFor('Mensalidade')).expect(200);
    expect(await statusOf()).toBe('ACTIVE');
    await request(server()).get('/v1/units').set(ownerAuth).expect(200);
  });

  it('issues next month a week before the due date', async () => {
    await billing().runDaily('2026-12-02');
    expect((await invoices()).some((invoice) => invoice.period === '2026-12')).toBe(false);

    await billing().runDaily('2026-12-03');
    const december = (await invoices()).find((invoice) => invoice.period === '2026-12');
    expect(december).toMatchObject({ status: 'PENDING', amountCents: 22900 });
  });
});
