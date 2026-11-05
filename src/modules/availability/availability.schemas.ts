import { z } from 'zod';

export const availabilityQuerySchema = z.object({
  unitId: z.uuid(),
  date: z.iso.date(),
  serviceIds: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(5)),
  staffId: z.uuid().optional(),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
