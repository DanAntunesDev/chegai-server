const FIXED_HOLIDAYS = [
  '01-01',
  '04-21',
  '05-01',
  '09-07',
  '10-12',
  '11-02',
  '11-15',
  '11-20',
  '12-25',
];

function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shift(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function nationalHolidays(year: number): Set<string> {
  const base = easter(year);
  const movable = [shift(base, -48), shift(base, -47), shift(base, -2), shift(base, 60)];
  return new Set([
    ...FIXED_HOLIDAYS.map((day) => `${year}-${day}`),
    ...movable.map((date) => toIsoDate(date)),
  ]);
}

export function isBusinessDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  return !nationalHolidays(date.getUTCFullYear()).has(toIsoDate(date));
}

export function addBusinessDays(date: Date, amount: number): Date {
  let cursor = date;
  let remaining = amount;
  while (remaining > 0) {
    cursor = shift(cursor, 1);
    if (isBusinessDay(cursor)) {
      remaining -= 1;
    }
  }
  return cursor;
}

export function nextBusinessDay(date: Date): Date {
  let cursor = date;
  while (!isBusinessDay(cursor)) {
    cursor = shift(cursor, 1);
  }
  return cursor;
}
