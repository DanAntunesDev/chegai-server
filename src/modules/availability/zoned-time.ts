const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function toLocalParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const local = toLocalParts(instant, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function localMinuteToInstant(date: string, minuteOfDay: number, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstOffset = offsetMinutes(new Date(guess), timeZone);
  const candidate = guess - firstOffset * 60000;
  const secondOffset = offsetMinutes(new Date(candidate), timeZone);
  return new Date(guess - secondOffset * 60000);
}

export function weekdayOf(date: string): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function localDateOf(instant: Date, timeZone: string): string {
  const local = toLocalParts(instant, timeZone);
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
