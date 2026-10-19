process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DATABASE_URL ??= 'postgresql://chegai_app:chegai_app@localhost:5432/chegai';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-32-chars';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString('base64');
