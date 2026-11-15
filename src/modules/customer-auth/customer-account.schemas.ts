import { z } from 'zod';
import { phoneField } from '../../common/validation/fields';

export const registerAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  phone: phoneField,
  password: z.string().min(8).max(128),
});

export const confirmAccountSchema = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/),
});

export const loginAccountSchema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
});

export type RegisterAccountInput = z.infer<typeof registerAccountSchema>;
export type ConfirmAccountInput = z.infer<typeof confirmAccountSchema>;
export type LoginAccountInput = z.infer<typeof loginAccountSchema>;
