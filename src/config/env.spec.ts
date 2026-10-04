import { validateEnv } from './env';

const baseEnv = {
  DATABASE_URL: 'postgresql://chegai:chegai@localhost:5432/chegai',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults to optional variables', () => {
    const env = validateEnv(baseEnv);

    expect(env.PORT).toBe(3333);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('splits multiple cors origins', () => {
    const env = validateEnv({
      ...baseEnv,
      CORS_ORIGINS: 'http://localhost:3000, https://painel.chegai.app',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://painel.chegai.app']);
  });

  it('rejects a missing database url', () => {
    expect(() => validateEnv({ REDIS_URL: baseEnv.REDIS_URL })).toThrow('DATABASE_URL');
  });
});
