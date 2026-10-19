import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { generateTotp } from '../../src/modules/auth/totp';

const OWNER = { email: 'dono@barbeariademo.com.br', password: 'chegai-dono-123' };

function refreshCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith('chegai_refresh='));
  if (!cookie) {
    throw new Error('refresh cookie missing');
  }
  return cookie.split(';')[0];
}

describe('auth', () => {
  let app: INestApplication;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const adminEmail = `admin-${randomUUID().slice(0, 8)}@chegai.test`;
  const adminPassword = 'admin-test-password';

  beforeAll(async () => {
    await db.connect();
    await db.query(
      `INSERT INTO users (id, email, name, password_hash, is_platform_admin, updated_at)
       VALUES ($1, $2, 'Admin Teste', $3, true, now())`,
      [randomUUID(), adminEmail, await hash(adminPassword)],
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE email = $1`, [adminEmail]);
    await db.end();
    await app.close();
  });

  it('logs the owner into the demo barbershop', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send(OWNER)
      .expect(200);

    expect(response.body.tenant.slug).toBe('barbearia-demo');
    expect(refreshCookie(response)).toMatch(/^chegai_refresh=/);

    const me = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);

    expect(me.body.role).toBe('OWNER');
    expect(me.body.permissions).toContain('billing.manage');
  });

  it('rejects a wrong password with a stable error code', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ ...OWNER, password: 'wrong-password' })
      .expect(401);

    expect(response.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('validates the request body', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('rotates refresh tokens and revokes the family when one is reused', async () => {
    const login = await request(app.getHttpServer()).post('/v1/auth/login').send(OWNER);
    const firstCookie = refreshCookie(login);

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);
    const secondCookie = refreshCookie(refreshed);
    expect(secondCookie).not.toBe(firstCookie);

    const reused = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(401);
    expect(reused.body.code).toBe('REFRESH_TOKEN_REUSED');

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', secondCookie)
      .expect(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const login = await request(app.getHttpServer()).post('/v1/auth/login').send(OWNER);
    const cookie = refreshCookie(login);

    await request(app.getHttpServer()).post('/v1/auth/logout').set('Cookie', cookie).expect(204);
    await request(app.getHttpServer()).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('requires two-factor authentication for the platform admin once enabled', async () => {
    const credentials = { email: adminEmail, password: adminPassword };
    const firstLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send(credentials)
      .expect(200);
    const token = firstLogin.body.accessToken as string;

    const setup = await request(app.getHttpServer())
      .post('/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    const stored = await db.query<{ totp_secret: string }>(
      `SELECT totp_secret FROM users WHERE email = $1`,
      [adminEmail],
    );
    expect(stored.rows[0].totp_secret).not.toContain(setup.body.secret);

    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: generateTotp(setup.body.secret as string) })
      .expect(200);

    const withoutCode = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send(credentials)
      .expect(401);
    expect(withoutCode.body.code).toBe('TOTP_REQUIRED');

    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ ...credentials, totpCode: generateTotp(setup.body.secret as string) })
      .expect(200);
  });
});
