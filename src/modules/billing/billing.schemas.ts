import { z } from 'zod';

export const startSubscriptionSchema = z.object({
  billingDay: z.number().int().min(1).max(28),
  chargeSetupFee: z.boolean().default(true),
});

export const runBillingSchema = z.object({
  today: z.iso.date().optional(),
});

export type StartSubscriptionInput = z.infer<typeof startSubscriptionSchema>;
export type RunBillingInput = z.infer<typeof runBillingSchema>;
