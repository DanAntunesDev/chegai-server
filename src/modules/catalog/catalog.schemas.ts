import { z } from 'zod';

export const categorySchema = z.object({
  name: z.string().min(2).max(60),
  position: z.number().int().min(0).default(0),
});

export const updateCategorySchema = categorySchema.partial();

const serviceFields = z.object({
  categoryId: z.uuid().nullable(),
  name: z.string().min(2).max(80),
  description: z.string().max(500).nullable(),
  priceCents: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive().max(600),
  bufferMinutes: z.number().int().min(0).max(120),
  position: z.number().int().min(0),
  isActive: z.boolean(),
});

export const createServiceSchema = serviceFields
  .partial()
  .required({ name: true, priceCents: true, durationMinutes: true });

export const updateServiceSchema = serviceFields.partial();

export const listServicesSchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type CategoryInput = z.infer<typeof categorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesInput = z.infer<typeof listServicesSchema>;
