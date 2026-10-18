import { validateEnv } from './env';

const baseEnv = {
  DATABASE_URL: 'postgresql://chegai:chegai@localhost:5432/chegai',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('validateEnv', () => {
  it('applies defaults to optional variables', () => {
    const env = validateEnv(baseEnv);

    expect(env.PORT).toBe(3333);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('splits multiple cors origins', () => {
    const env = validateEnv({
      ...baseEnv,
      CORS_ORIGINS: 'http://localhost:3000, https://painel.chegai.app',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://painel.chegai.app']);
  });

  it('rejects a missing database url', () => {
    const { DATABASE_URL: _removed, ...withoutDatabase } = baseEnv;
    expect(() => validateEnv(withoutDatabase)).toThrow('DATABASE_URL');
  });

  it('rejects an encryption key with the wrong size', () => {
    expect(() => validateEnv({ ...baseEnv, ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow('ENCRYPTION_KEY');
  });
});
