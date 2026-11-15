import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app';

describe('admin console', () => {
  let ctx: TestApp;
  let adminAuth: { Authorization: string };
  const slug = `console-${randomUUID().slice(0, 8)}`;
  const email = `ops-${randomUUID().slice(0, 8)}@teste.com`;
  let tenantId = '';
  let userId = '';

  const server = () => ctx.app.getHttpServer();

  beforeAll(async () => {
    ctx = await createTestApp();
    adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Console LTDA',
        displayName: 'Console',
        email: 'console@teste.com',
        planCode: 'PROFISSIONAL',
        status: 'ACTIVE',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('summarizes the platform with filters', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(server())
      .get('/v1/admin/metrics')
      .query({ from: today, to: today, status: 'ACTIVE' })
      .set(adminAuth)
      .expect(200);

    expect(response.body.tenants.byStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(response.body.tenants.byStatus.TRIAL).toBe(0);
    expect(response.body.tenants.mrrCents).toBeGreaterThan(0);
    expect(response.body.daily).toHaveLength(1);
    const top = response.body.topTenants as { id: string }[];
    expect(top.some((item) => item.id === tenantId)).toBe(true);

    await request(server())
      .get('/v1/admin/metrics')
      .query({ from: today, to: '2020-01-01' })
      .set(adminAuth)
      .expect(400);
  });

  it('creates platform users and keeps passwords out of responses', async () => {
    const created = await request(server())
      .post('/v1/admin/users')
      .set(adminAuth)
      .send({ name: 'Operação', email, password: 'senha-forte-123', isPlatformAdmin: true })
      .expect(201);
    userId = created.body.id as string;
    expect(created.body).not.toHaveProperty('passwordHash');
    expect(created.body.isPlatformAdmin).toBe(true);

    await request(server())
      .post('/v1/admin/users')
      .set(adminAuth)
      .send({ name: 'Outro', email, password: 'senha-forte-123' })
      .expect(409);

    const list = await request(server())
      .get('/v1/admin/users')
      .query({ search: email })
      .set(adminAuth)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('lets a platform admin open any barbershop panel', async () => {
    const token = await ctx.tokenFor({ sub: userId, adm: true, mfa: true });
    const session = await request(server())
      .post('/v1/auth/switch-tenant')
      .set({ Authorization: `Bearer ${token}` })
      .send({ tenantSlug: slug })
      .expect(200);
    expect(session.body.tenant.id).toBe(tenantId);

    const units = await request(server())
      .get('/v1/units')
      .set({ Authorization: `Bearer ${session.body.accessToken as string}` })
      .expect(200);
    expect(units.body).toHaveLength(1);
  });

  it('stops admins from removing their own access and blocks other users', async () => {
    const token = await ctx.tokenFor({ sub: userId, adm: true, mfa: true });
    await request(server())
      .patch(`/v1/admin/users/${userId}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ isPlatformAdmin: false })
      .expect(409);

    const plain = await ctx.tokenFor({ adm: false, mfa: true });
    await request(server())
      .get('/v1/admin/users')
      .set({ Authorization: `Bearer ${plain}` })
      .expect(403);
    await request(server())
      .get('/v1/admin/metrics')
      .query({ from: '2026-11-01', to: '2026-11-30' })
      .set({ Authorization: `Bearer ${plain}` })
      .expect(403);
  });
});
