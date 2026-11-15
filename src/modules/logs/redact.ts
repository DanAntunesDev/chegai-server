const SENSITIVE =
  /pass(word)?|senha|token|secret|api[-_]?key|authorization|cookie|totp|^code$|otp|hash|cvv|card/i;
const MAX_STRING = 2_000;
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

export const HIDDEN = '[oculto]';

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[…]';
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `+${value.length - MAX_ITEMS}`] : items;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE.test(key) && item !== null && item !== '' ? HIDDEN : redact(item, depth + 1),
    ]),
  );
}

const KEPT_HEADERS = [
  'content-type',
  'origin',
  'referer',
  'x-forwarded-for',
  'idempotency-key',
  'accept-language',
];

export function pickHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    KEPT_HEADERS.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]),
  );
}

export function parseBody(raw: unknown): unknown {
  if (Buffer.isBuffer(raw)) {
    return parseBody(raw.toString('utf8'));
  }
  if (typeof raw !== 'string') {
    return raw ?? null;
  }
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw.slice(0, MAX_STRING);
  }
}
