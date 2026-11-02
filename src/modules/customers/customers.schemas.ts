import { z } from 'zod';
import { paginationSchema, phoneField } from '../../common/validation/fields';

const tagField = z
  .string()
  .min(1)
  .max(30)
  .transform((value) => value.trim().toLowerCase());

const customerFields = z.object({
  name: z.string().min(2).max(120),
  phone: phoneField,
  email: z.email().nullable(),
  birthDate: z.iso.date().nullable(),
  notes: z.string().max(2000).nullable(),
  tags: z.array(tagField).max(20),
  marketingOptIn: z.boolean(),
});

export const createCustomerSchema = customerFields.partial().required({ name: true, phone: true });

export const updateCustomerSchema = customerFields.partial();

export const listCustomersSchema = paginationSchema.extend({
  search: z.string().min(1).max(100).optional(),
  tag: tagField.optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
