import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/modules/access/permissions';
import { createTestApp, type TestApp } from '../support/app';

describe('tags', () => {
  let ctx: TestApp;
  const slug = `tags-${randomUUID().slice(0, 8)}`;
  let tenantId = '';
  let auth: { Authorization: string };
  let barberAuth: { Authorization: string };
  let unitId = '';

  const server = () => ctx.app.getHttpServer();

  beforeAll(async () => {
    ctx = await createTestApp();
    const adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };
    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Tags LTDA',
        displayName: 'Tags',
        email: 'tags@teste.com',
        planCode: 'PROFISSIONAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;
    auth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };
    const barber = SYSTEM_ROLES.find((role) => role.key === 'BARBER');
    barberAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'BARBER', perms: [...(barber?.permissions ?? [])] })}`,
    };
    unitId = (await request(server()).get('/v1/units').set(auth)).body[0].id as string;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('manages tags and links them to customers and staff', async () => {
    const vip = await request(server())
      .post('/v1/tags')
      .set(auth)
      .send({ name: 'VIP', color: '#b45309', note: 'Clientes da casa', scope: 'CUSTOMERS' })
      .expect(201);
    const all = await request(server())
      .post('/v1/tags')
      .set(auth)
      .send({ name: 'Barba' })
      .expect(201);

    const duplicate = await request(server())
      .post('/v1/tags')
      .set(auth)
      .send({ name: 'vip' })
      .expect(409);
    expect(duplicate.body.code).toBe('TAG_NAME_TAKEN');
    await request(server()).post('/v1/tags').set(barberAuth).send({ name: 'Nova' }).expect(403);

    const customer = await request(server())
      .post('/v1/customers')
      .set(auth)
      .send({ name: 'Cliente Tag', phone: '38998887777', tagIds: [vip.body.id, all.body.id] })
      .expect(201);
    expect((customer.body.tags as { name: string }[]).map((tag) => tag.name).sort()).toEqual([
      'Barba',
      'VIP',
    ]);
    expect(customer.body).not.toHaveProperty('passwordHash');

    const staffWithVip = await request(server())
      .post('/v1/staff')
      .set(auth)
      .send({ name: 'Rafa', unitIds: [unitId], tagIds: [vip.body.id] })
      .expect(400);
    expect(staffWithVip.body.code).toBe('TAG_NOT_FOUND');

    const staff = await request(server())
      .post('/v1/staff')
      .set(auth)
      .send({ name: 'Rafa', unitIds: [unitId], tagIds: [all.body.id] })
      .expect(201);
    expect(staff.body.tags).toEqual([{ id: all.body.id, name: 'Barba', color: '#64748b' }]);

    const filtered = await request(server())
      .get('/v1/customers')
      .query({ tagId: vip.body.id })
      .set(auth)
      .expect(200);
    expect(filtered.body.total).toBe(1);

    await request(server())
      .patch(`/v1/tags/${all.body.id}`)
      .set(auth)
      .send({ color: '#1e4fd8', scope: 'CUSTOMERS' })
      .expect(200);
    const listed = await request(server()).get('/v1/tags').set(auth).expect(200);
    const barba = (listed.body as { id: string }[]).find((tag) => tag.id === all.body.id);
    expect(barba).toMatchObject({ color: '#1e4fd8', customersCount: 1, staffCount: 0 });

    await request(server()).delete(`/v1/tags/${vip.body.id}`).set(auth).expect(204);
    const after = await request(server())
      .get(`/v1/customers/${customer.body.id}`)
      .set(auth)
      .expect(200);
    expect(after.body.tags).toHaveLength(1);
  });
});
