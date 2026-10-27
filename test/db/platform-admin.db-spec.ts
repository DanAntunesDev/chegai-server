import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('platform admin', () => {
  let ctx: TestApp;
  let adminToken: string;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const slug = `barbearia-${randomUUID().slice(0, 8)}`;
  const ownerEmail = `dono-${randomUUID().slice(0, 8)}@teste.com`;
  let tenantId = '';

  beforeAll(async () => {
    await db.connect();
    ctx = await createTestApp();
    adminToken = await ctx.tokenFor({ adm: true, mfa: true });
  });

  afterAll(async () => {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await db.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
    await db.query('COMMIT');
    await db.query(`DELETE FROM users WHERE email = $1`, [ownerEmail]);
    await db.end();
    await ctx.app.close();
  });

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  it('keeps regular users and admins without mfa out', async () => {
    const owner = await ctx.tokenFor({ tid: randomUUID(), role: 'OWNER' });
    const noMfa = await ctx.tokenFor({ adm: true, mfa: false });

    const denied = await request(ctx.app.getHttpServer())
      .get('/v1/admin/tenants')
      .set('Authorization', `Bearer ${owner}`)
      .expect(403);
    expect(denied.body.code).toBe('PLATFORM_ADMIN_REQUIRED');

    const mfa = await request(ctx.app.getHttpServer())
      .get('/v1/admin/tenants')
      .set('Authorization', `Bearer ${noMfa}`)
      .expect(403);
    expect(mfa.body.code).toBe('MFA_REQUIRED');
  });

  it('creates a barbershop with its unit, roles and owner invitation', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/v1/admin/tenants')
      .set(admin())
      .send({
        slug,
        legalName: 'Barbearia Teste LTDA',
        displayName: 'Barbearia Teste',
        email: 'contato@teste.com',
        planCode: 'ESSENCIAL',
        unit: { name: 'Centro', city: 'Montes Claros', state: 'MG' },
        owner: { email: ownerEmail, name: 'Fulano' },
      })
      .expect(201);

    tenantId = response.body.tenant.id as string;
    expect(response.body.tenant.status).toBe('TRIAL');
    expect(response.body.tenant.unitsCount).toBe(1);
    expect(response.body.tenant.entitlements.limits.barbers).toBe(3);
    expect(ctx.mail.sent.at(-1)?.to).toBe(ownerEmail);
    expect(ctx.mail.sent.at(-1)?.text).toContain(response.body.invitation.link);

    const duplicate = await request(ctx.app.getHttpServer())
      .post('/v1/admin/tenants')
      .set(admin())
      .send({
        slug,
        legalName: 'Outra',
        displayName: 'Outra',
        email: 'outra@teste.com',
        planCode: 'ESSENCIAL',
        unit: { name: 'Centro' },
        owner: { email: 'outra@teste.com', name: 'Outra' },
      })
      .expect(409);
    expect(duplicate.body.code).toBe('SLUG_TAKEN');
  });

  it('applies white label colors and logo', async () => {
    const invalid = await request(ctx.app.getHttpServer())
      .put(`/v1/admin/tenants/${tenantId}/branding`)
      .set(admin())
      .send({ primaryColor: 'red' })
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');

    await request(ctx.app.getHttpServer())
      .put(`/v1/admin/tenants/${tenantId}/branding`)
      .set(admin())
      .send({ primaryColor: '#112233', secondaryColor: '#445566' })
      .expect(200);

    const uploaded = await request(ctx.app.getHttpServer())
      .post(`/v1/admin/tenants/${tenantId}/branding/logo`)
      .set(admin())
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(uploaded.body.logoUrl).toMatch(
      /^https:\/\/cdn\.test\/tenants\/.+\/branding\/logo-.+\.png$/,
    );

    const svg = await request(ctx.app.getHttpServer())
      .post(`/v1/admin/tenants/${tenantId}/branding/icon`)
      .set(admin())
      .attach('file', Buffer.from('<svg/>'), { filename: 'icon.svg', contentType: 'image/svg+xml' })
      .expect(400);
    expect(svg.body.code).toBe('UNSUPPORTED_FILE_TYPE');

    const publicBranding = await request(ctx.app.getHttpServer())
      .get(`/v1/public/tenants/${slug}/branding`)
      .expect(200);
    expect(publicBranding.body.primaryColor).toBe('#112233');
    expect(publicBranding.body.logoUrl).toBe(uploaded.body.logoUrl);
  });

  it('lets the owner accept the invitation and rename only when allowed', async () => {
    const link =
      ctx.mail.sent
        .find((mail) => mail.to === ownerEmail)
        ?.text.split('\n')
        .at(-1) ?? '';
    const token = link.split('/convite/')[1];

    const preview = await request(ctx.app.getHttpServer())
      .get(`/v1/auth/invitations/${token}`)
      .expect(200);
    expect(preview.body.barbershop).toBe('Barbearia Teste');
    expect(preview.body.userExists).toBe(false);

    const accepted = await request(ctx.app.getHttpServer())
      .post('/v1/auth/invitations/accept')
      .send({ token, password: 'senha-do-dono-123' })
      .expect(200);
    expect(accepted.body.tenant.slug).toBe(slug);
    const ownerAuth = { Authorization: `Bearer ${accepted.body.accessToken}` };

    await request(ctx.app.getHttpServer())
      .post('/v1/auth/invitations/accept')
      .send({ token, password: 'senha-do-dono-123' })
      .expect(404);

    const current = await request(ctx.app.getHttpServer())
      .get('/v1/tenant')
      .set(ownerAuth)
      .expect(200);
    expect(current.body.entitlements.features).toContain('public_booking');

    const blocked = await request(ctx.app.getHttpServer())
      .patch('/v1/tenant')
      .set(ownerAuth)
      .send({ displayName: 'Novo Nome' })
      .expect(403);
    expect(blocked.body.code).toBe('RENAME_NOT_ALLOWED');

    await request(ctx.app.getHttpServer())
      .put(`/v1/admin/tenants/${tenantId}/branding`)
      .set(admin())
      .send({ allowOwnerRename: true })
      .expect(200);

    const renamed = await request(ctx.app.getHttpServer())
      .patch('/v1/tenant')
      .set(ownerAuth)
      .send({ displayName: 'Novo Nome' })
      .expect(200);
    expect(renamed.body.displayName).toBe('Novo Nome');
  });

  it('changes plan and per-barbershop overrides', async () => {
    const response = await request(ctx.app.getHttpServer())
      .patch(`/v1/admin/tenants/${tenantId}`)
      .set(admin())
      .send({
        planCode: 'PROFISSIONAL',
        status: 'ACTIVE',
        limitOverrides: { barbers: 10 },
        featureOverrides: { enabled: ['loyalty'], disabled: [] },
      })
      .expect(200);

    expect(response.body.plan.code).toBe('PROFISSIONAL');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.entitlements.limits.barbers).toBe(10);
    expect(response.body.entitlements.features).toContain('loyalty');
  });
});
