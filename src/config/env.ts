import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const blankAsMissing = (value: unknown) => (value === '' ? undefined : value);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'must be 32 bytes encoded in base64',
  }),
  COOKIE_SECURE: booleanFromString,
  WEB_URL: z.url().default('http://localhost:3000'),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_PUBLIC_URL: z.url(),
  S3_FORCE_PATH_STYLE: booleanFromString,
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  API_DOCS_ENABLED: booleanFromString,
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  TRUST_PROXY: booleanFromString,
  ASAAS_API_URL: z.url().default('https://api-sandbox.asaas.com/v3'),
  ASAAS_API_KEY: z.preprocess(blankAsMissing, z.string().min(1).optional()),
  ASAAS_WEBHOOK_TOKEN: z.preprocess(blankAsMissing, z.string().min(16).optional()),
  BILLING_JOB_ENABLED: booleanFromString,
  BILLING_GRACE_BUSINESS_DAYS: z.coerce.number().int().min(0).max(30).default(5),
  BOOKING_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
  MAIL_FROM: z.string().default('Chegaí <nao-responda@chegai.app>'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}
