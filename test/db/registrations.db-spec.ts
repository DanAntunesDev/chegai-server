import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/modules/access/permissions';
import { createTestApp, type TestApp } from '../support/app';

describe('units, staff, services and customers', () => {
  let ctx: TestApp;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `cadastros-${randomUUID().slice(0, 8)}`;
  let tenantId = '';
  let unitId = '';
  let ownerAuth: { Authorization: string };
  let adminAuth: { Authorization: string };

  const server = () => ctx.app.getHttpServer();

  beforeAll(async () => {
    await db.connect();
    ctx = await createTestApp();
    adminAuth = { Authorization: `Bearer ${await ctx.tokenFor({ adm: true, mfa: true })}` };

    const created = await request(server())
      .post('/v1/admin/tenants')
      .set(adminAuth)
      .send({
        slug,
        legalName: 'Cadastros LTDA',
        displayName: 'Cadastros',
        email: 'cadastros@teste.com',
        planCode: 'ESSENCIAL',
        unit: { name: 'Centro' },
        owner: { email: `dono-${slug}@teste.com`, name: 'Dono' },
      })
      .expect(201);
    tenantId = created.body.tenant.id as string;

    ownerAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: tenantId, role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };
    const units = await request(server()).get('/v1/units').set(ownerAuth).expect(200);
    unitId = units.body[0].id as string;
  });

  afterAll(async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await db.query('COMMIT');
    await db.end();
    await ctx.app.close();
  });

  it('enforces the unit limit of the plan', async () => {
    const response = await request(server())
      .post('/v1/units')
      .set(ownerAuth)
      .send({ name: 'Bairro', slug: 'bairro' })
      .expect(403);

    expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(response.body.details).toEqual({ resource: 'units', limit: 1, current: 1 });
  });

  it('enforces the barber limit and its per-barbershop override', async () => {
    for (let index = 0; index < 3; index += 1) {
      await request(server())
        .post('/v1/staff')
        .set(ownerAuth)
        .send({ name: `Barbeiro ${index}`, unitIds: [unitId] })
        .expect(201);
    }

    await request(server())
      .post('/v1/staff')
      .set(ownerAuth)
      .send({ name: 'Barbeiro extra', unitIds: [unitId] })
      .expect(403);

    await request(server())
      .post('/v1/staff')
      .set(ownerAuth)
      .send({ kind: 'MANAGER', name: 'Gerente', unitIds: [unitId] })
      .expect(201);

    await request(server())
      .patch(`/v1/admin/tenants/${tenantId}`)
      .set(adminAuth)
      .send({ limitOverrides: { barbers: 4 } })
      .expect(200);

    await request(server())
      .post('/v1/staff')
      .set(ownerAuth)
      .send({ name: 'Barbeiro extra', unitIds: [unitId] })
      .expect(201);
  });

  it('validates and stores working hours as HH:MM', async () => {
    const staff = await request(server()).get('/v1/staff?kind=BARBER').set(ownerAuth).expect(200);
    const staffId = staff.body[0].id as string;

    const overlap = await request(server())
      .put(`/v1/staff/${staffId}/working-hours`)
      .set(ownerAuth)
      .send({
        intervals: [
          { unitId, weekday: 1, start: '09:00', end: '13:00' },
          { unitId, weekday: 1, start: '12:00', end: '19:00' },
        ],
      })
      .expect(400);
    expect(overlap.body.code).toBe('WORKING_HOURS_OVERLAP');

    await request(server())
      .put(`/v1/staff/${staffId}/working-hours`)
      .set(ownerAuth)
      .send({
        intervals: [
          { unitId, weekday: 1, start: '09:00', end: '12:00' },
          { unitId, weekday: 1, start: '13:00', end: '19:00' },
        ],
      })
      .expect(204);

    const detail = await request(server()).get(`/v1/staff/${staffId}`).set(ownerAuth).expect(200);
    expect(detail.body.workingHours).toMatchObject([
      { weekday: 1, start: '09:00', end: '12:00' },
      { weekday: 1, start: '13:00', end: '19:00' },
    ]);
  });

  it('manages services with per-barber price and duration', async () => {
    const category = await request(server())
      .post('/v1/service-categories')
      .set(ownerAuth)
      .send({ name: 'Cabelo' })
      .expect(201);

    const service = await request(server())
      .post('/v1/services')
      .set(ownerAuth)
      .send({
        name: 'Corte degradê',
        categoryId: category.body.id,
        priceCents: 4500,
        durationMinutes: 40,
        bufferMinutes: 10,
      })
      .expect(201);

    const staff = await request(server()).get('/v1/staff?kind=BARBER').set(ownerAuth).expect(200);
    const staffId = staff.body[0].id as string;

    await request(server())
      .put(`/v1/staff/${staffId}/services`)
      .set(ownerAuth)
      .send({ services: [{ serviceId: service.body.id, priceCents: 5500, durationMinutes: 35 }] })
      .expect(204);

    const detail = await request(server()).get(`/v1/staff/${staffId}`).set(ownerAuth).expect(200);
    expect(detail.body.services[0]).toMatchObject({ priceCents: 5500, durationMinutes: 35 });

    const list = await request(server()).get('/v1/services').set(ownerAuth).expect(200);
    expect(list.body[0].category.name).toBe('Cabelo');
  });

  it('stores customers with normalized phones and finds them by any phone format', async () => {
    await request(server())
      .post('/v1/customers')
      .set(ownerAuth)
      .send({ name: 'João Cliente', phone: '(38) 99999-1234', tags: ['VIP'] })
      .expect(201);

    const duplicate = await request(server())
      .post('/v1/customers')
      .set(ownerAuth)
      .send({ name: 'Outro', phone: '+55 38 99999-1234' })
      .expect(409);
    expect(duplicate.body.code).toBe('CUSTOMER_PHONE_TAKEN');

    const byPhone = await request(server())
      .get('/v1/customers')
      .query({ search: '38999991234' })
      .set(ownerAuth)
      .expect(200);
    expect(byPhone.body.items[0].phone).toBe('+5538999991234');

    const byTag = await request(server())
      .get('/v1/customers')
      .query({ tag: 'vip' })
      .set(ownerAuth)
      .expect(200);
    expect(byTag.body.total).toBe(1);
  });

  it('lets a barber block only their own schedule', async () => {
    const barberUserId = randomUUID();
    const staff = await request(server()).get('/v1/staff?kind=BARBER').set(ownerAuth).expect(200);
    const [own, other] = staff.body as { id: string }[];

    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(`UPDATE staff SET user_id = $1 WHERE id = $2`, [barberUserId, own.id]);
    await db.query('COMMIT');

    const barber = SYSTEM_ROLES.find((role) => role.key === 'BARBER');
    const barberAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({
        sub: barberUserId,
        tid: tenantId,
        role: 'BARBER',
        perms: [...(barber?.permissions ?? [])],
      })}`,
    };
    const block = {
      kind: 'BREAK',
      startsAt: '2026-12-01T12:00:00-03:00',
      endsAt: '2026-12-01T13:00:00-03:00',
    };

    await request(server())
      .post(`/v1/staff/${own.id}/blocks`)
      .set(barberAuth)
      .send(block)
      .expect(201);
    await request(server())
      .post(`/v1/staff/${other.id}/blocks`)
      .set(barberAuth)
      .send(block)
      .expect(403);
    await request(server())
      .post('/v1/customers')
      .set(barberAuth)
      .send({ name: 'Sem permissão', phone: '38988887777' })
      .expect(403);
  });

  it('never shows data from another barbershop', async () => {
    const strangerAuth = {
      Authorization: `Bearer ${await ctx.tokenFor({ tid: randomUUID(), role: 'OWNER', perms: [...PERMISSIONS] })}`,
    };

    const services = await request(server()).get('/v1/services').set(strangerAuth).expect(200);
    const customers = await request(server()).get('/v1/customers').set(strangerAuth).expect(200);

    expect(services.body).toEqual([]);
    expect(customers.body.total).toBe(0);
  });
});
