import request from 'supertest';
import { LogsService } from '../../src/modules/logs/logs.service';
import { createTestApp, type TestApp } from '../support/app';

describe('logs', () => {
  let ctx: TestApp;
  let adminAuth: { Authorization: string };
  const server = () => ctx.app.getHttpServer();
  const email = `logs-${Date.now()}@teste.com`;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const waitForLog = async () => {
    for (let i = 0; i < 40; i += 1) {
      const found = await request(server())
        .get('/v1/admin/logs/requests')
        .query({ search: '/v1/auth/login', status: 'client_error', pageSize: 50 })
        .set(adminAuth);
      const item = (found.body.items as { id: string; payload?: unknown }[]).find(Boolean);
      if (item) {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('request log not written');
  };

  it('records failed requests without secrets and shows them to admins only', async () => {
    await request(server())
      .post('/v1/auth/login')
      .send({ email, password: 'senha-que-nao-pode-vazar' })
      .expect(401);

    const listed = await waitForLog();
    const detail = await request(server())
      .get(`/v1/admin/logs/requests/${listed.id}`)
      .set(adminAuth)
      .expect(200);
    expect(detail.body).toMatchObject({
      method: 'POST',
      path: '/v1/auth/login',
      statusCode: 401,
      errorCode: 'INVALID_CREDENTIALS',
      actor: 'anonymous',
    });
    expect(JSON.stringify(detail.body)).not.toContain('senha-que-nao-pode-vazar');
    expect(detail.body.headers).not.toHaveProperty('authorization');

    const ownerAuth = { Authorization: `Bearer ${await ctx.tokenFor({})}` };
    await request(server()).get('/v1/admin/logs/requests').set(ownerAuth).expect(403);
  });

  it('lists audit entries with the actions available to filter', async () => {
    const created = await request(server())
      .post('/v1/admin/webhooks')
      .set(adminAuth)
      .send({ name: 'Auditoria', url: 'https://example.com/hook', events: ['booking.confirmed'] })
      .expect(201);
    await request(server())
      .delete(`/v1/admin/webhooks/${created.body.id}`)
      .set(adminAuth)
      .expect(200);
    const response = await request(server())
      .get('/v1/admin/logs/audit')
      .query({ action: 'webhook.deleted' })
      .set(adminAuth)
      .expect(200);
    expect(response.body.actions).toEqual(
      expect.arrayContaining(['webhook.created', 'webhook.deleted']),
    );
    expect(response.body.items[0]).toMatchObject({
      entity: 'webhook',
      entityId: created.body.id,
      before: { name: 'Auditoria' },
    });
  });

  it('removes request logs past the retention window', async () => {
    const removed = await ctx.app.get(LogsService).sweep(new Date(Date.now() + 40 * 86_400_000));
    expect(removed).toBeGreaterThan(0);
  });
});
