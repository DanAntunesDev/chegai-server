import { z } from 'zod';

export const createPaymentLinkSchema = z.object({
  kind: z.enum(['DEPOSIT', 'FULL', 'REMAINDER']),
});
export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

export const paymentSettingsSchema = z.object({
  depositPercent: z.number().int().min(10).max(100).optional(),
  depositRequired: z.boolean().optional(),
});
export type PaymentSettingsInput = z.infer<typeof paymentSettingsSchema>;
