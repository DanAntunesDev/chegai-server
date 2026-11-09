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

export const rescheduleBookingSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  staffId: z.uuid().optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(2).max(300).optional(),
});

export const listBookingsSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    unitId: z.uuid().optional(),
    staffId: z.uuid().optional(),
    status: z
      .string()
      .transform((value) => value.split(',').filter(Boolean))
      .pipe(
        z.array(z.enum(['HOLD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELED', 'NO_SHOW'])),
      )
      .optional(),
  })
  .refine((input) => new Date(input.from) < new Date(input.to), {
    message: 'from must be before to',
  })
  .refine((input) => new Date(input.to).getTime() - new Date(input.from).getTime() <= 62 * 864e5, {
    message: 'the range cannot exceed 62 days',
  });

export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsSchema>;
