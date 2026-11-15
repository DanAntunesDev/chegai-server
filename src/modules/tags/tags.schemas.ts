import { z } from 'zod';

export const tagScopeSchema = z.enum(['ALL', 'CUSTOMERS', 'STAFF']);

const tagFields = z.object({
  name: z.string().trim().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  note: z.string().trim().max(500).nullable(),
  scope: tagScopeSchema,
});

export const createTagSchema = tagFields.partial({ color: true, note: true, scope: true });
export const updateTagSchema = tagFields.partial();
export const tagIdsField = z.array(z.uuid()).max(20);

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
