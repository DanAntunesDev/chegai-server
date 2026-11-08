import { z } from 'zod';
import { phoneField, slugField } from '../../common/validation/fields';

export const unitFieldsSchema = z.object({
  name: z.string().min(2).max(80),
  slug: slugField,
  phone: phoneField.nullable(),
  street: z.string().max(120).nullable(),
  number: z.string().max(20).nullable(),
  district: z.string().max(80).nullable(),
  city: z.string().max(80).nullable(),
  state: z.string().length(2).nullable(),
  zipCode: z
    .string()
    .regex(/^\d{5}-?\d{3}$/)
    .nullable(),
  timezone: z.string().min(3),
  slotIntervalMinutes: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
  ]),
  minAdvanceMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
  maxAdvanceDays: z.number().int().min(1).max(180),
  noShowAfterMinutes: z.number().int().min(0).max(1440),
});

export const createUnitSchema = unitFieldsSchema.partial().required({ name: true, slug: true });
export const updateUnitSchema = unitFieldsSchema.partial();

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
