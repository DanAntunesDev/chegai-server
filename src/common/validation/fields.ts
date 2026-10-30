import { z } from 'zod';

export function normalizeBrazilianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;

  if (!/^[1-9]{2}9?\d{8}$/.test(national)) {
    return null;
  }

  return `+55${national}`;
}

export const phoneField = z.string().transform((value, context) => {
  const phone = normalizeBrazilianPhone(value);
  if (!phone) {
    context.addIssue({ code: 'custom', message: 'must be a valid Brazilian phone number' });
    return z.NEVER;
  }
  return phone;
});

export const slugField = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and hyphens');

export const timeOfDayField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'must be HH:MM')
  .transform((value) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  });

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${(minutes % 60).toString().padStart(2, '0')}`;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
