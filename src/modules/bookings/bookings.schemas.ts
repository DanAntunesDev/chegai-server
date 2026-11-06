import { z } from 'zod';
import { phoneField } from '../../common/validation/fields';

export const createHoldSchema = z.object({
  unitId: z.uuid(),
  serviceIds: z.array(z.uuid()).min(1).max(5),
  startsAt: z.iso.datetime({ offset: true }),
  staffId: z.uuid().optional(),
});

export const confirmBookingSchema = z
  .object({
    customerId: z.uuid().optional(),
    customer: z
      .object({
        name: z.string().min(2).max(120),
        phone: phoneField,
      })
      .optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((input) => Boolean(input.customerId) !== Boolean(input.customer), {
    message: 'send either customerId or customer',
  });

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;
