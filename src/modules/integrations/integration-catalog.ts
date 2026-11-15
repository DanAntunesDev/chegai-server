import { z } from 'zod';

const optionalText = z.string().trim().max(500).optional();
const optionalSecret = z.string().trim().max(2000).optional();
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value), 'must be a valid url')
  .optional();

export const INTEGRATIONS = {
  asaas: {
    schema: z.object({ apiUrl: optionalUrl, apiKey: optionalSecret, webhookToken: optionalSecret }),
    secrets: ['apiKey', 'webhookToken'],
  },
  whatsapp: {
    schema: z.object({
      appId: optionalText,
      appSecret: optionalSecret,
      businessAccountId: optionalText,
      phoneNumberId: optionalText,
      accessToken: optionalSecret,
      verifyToken: optionalSecret,
    }),
    secrets: ['appSecret', 'accessToken', 'verifyToken'],
  },
  n8n: {
    schema: z.object({
      baseUrl: optionalUrl,
      apiKey: optionalSecret,
      agentWebhookUrl: optionalUrl,
    }),
    secrets: ['apiKey'],
  },
  google: {
    schema: z.object({
      clientId: optionalText,
      clientSecret: optionalSecret,
      redirectUrl: optionalUrl,
    }),
    secrets: ['clientSecret'],
  },
  openai: {
    schema: z.object({ apiKey: optionalSecret, transcriptionModel: optionalText }),
    secrets: ['apiKey'],
  },
} as const;

export type IntegrationKey = keyof typeof INTEGRATIONS;

export const integrationKeySchema = z.enum(
  Object.keys(INTEGRATIONS) as [IntegrationKey, ...IntegrationKey[]],
);

export type IntegrationValues = Record<string, string | undefined>;

export function mergeSettings(
  key: IntegrationKey,
  current: IntegrationValues,
  incoming: IntegrationValues,
): IntegrationValues {
  const secrets = INTEGRATIONS[key].secrets as readonly string[];
  const next: IntegrationValues = { ...current };
  for (const [field, value] of Object.entries(incoming)) {
    if (value === undefined) {
      continue;
    }
    if (secrets.includes(field) && value === '') {
      continue;
    }
    next[field] = value === '' ? undefined : value;
  }
  return next;
}

export function maskSettings(key: IntegrationKey, values: IntegrationValues) {
  const secrets = INTEGRATIONS[key].secrets as readonly string[];
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value)
      .map(([field, value]) => [
        field,
        secrets.includes(field) ? { set: true, hint: `••••${(value ?? '').slice(-4)}` } : value,
      ]),
  );
}
