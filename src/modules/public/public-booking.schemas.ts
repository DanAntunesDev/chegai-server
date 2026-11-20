import { z } from 'zod';
import { phoneField } from '../../common/validation/fields';

export const requestCodeSchema = z.object({ phone: phoneField });

export const verifyCodeSchema = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'must have 6 digits'),
});

export const publicConfirmSchema = z.object({
  name: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(300).optional(),
});

export type RequestCodeInput = z.infer<typeof requestCodeSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
export type PublicConfirmInput = z.infer<typeof publicConfirmSchema>;
