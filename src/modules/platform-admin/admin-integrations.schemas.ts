import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../integrations/webhook-events';

export const webhookEndpointSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  tenantId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type WebhookEndpointInput = z.infer<typeof webhookEndpointSchema>;

export const updateWebhookEndpointSchema = webhookEndpointSchema.partial();
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;

export const tenantPaymentsSchema = z.object({
  apiKey: z.string().trim().max(2000).nullable().optional(),
  depositPercent: z.number().int().min(10).max(100).optional(),
});
export type TenantPaymentsInput = z.infer<typeof tenantPaymentsSchema>;
