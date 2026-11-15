import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

export const metricsQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'BLOCKED', 'CANCELED']).optional(),
    planCode: z.string().min(1).max(40).optional(),
  })
  .refine((value) => value.from <= value.to, { message: 'from must be before to', path: ['to'] })
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= 366, {
    message: 'range up to one year',
    path: ['to'],
  });

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const listUsersSchema = z.object({
  search: z.string().trim().max(100).optional(),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  password: z.string().min(10).max(128),
  isPlatformAdmin: z.boolean().default(false),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    isPlatformAdmin: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
