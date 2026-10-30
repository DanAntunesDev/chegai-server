import { z } from 'zod';
import { phoneField, timeOfDayField } from '../../common/validation/fields';

export const staffKindSchema = z.enum(['BARBER', 'RECEPTIONIST', 'MANAGER']);

export const createStaffSchema = z.object({
  kind: staffKindSchema.default('BARBER'),
  name: z.string().min(2).max(80),
  nickname: z.string().max(40).optional(),
  phone: phoneField.optional(),
  email: z.email().optional(),
  userId: z.uuid().optional(),
  unitIds: z.array(z.uuid()).min(1),
});

export const updateStaffSchema = z
  .object({
    name: z.string().min(2).max(80),
    nickname: z.string().max(40).nullable(),
    phone: phoneField.nullable(),
    email: z.email().nullable(),
    userId: z.uuid().nullable(),
    unitIds: z.array(z.uuid()).min(1),
    isActive: z.boolean(),
  })
  .partial();

export const listStaffSchema = z.object({
  unitId: z.uuid().optional(),
  kind: staffKindSchema.optional(),
});

export const workingHoursSchema = z.object({
  intervals: z
    .array(
      z
        .object({
          unitId: z.uuid(),
          weekday: z.number().int().min(0).max(6),
          start: timeOfDayField,
          end: timeOfDayField,
        })
        .refine((interval) => interval.start < interval.end, {
          message: 'start must be before end',
        }),
    )
    .max(50),
});

export const createBlockSchema = z
  .object({
    kind: z.enum(['VACATION', 'DAY_OFF', 'BREAK', 'BLOCK']).default('BLOCK'),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().max(200).optional(),
  })
  .refine((block) => new Date(block.startsAt) < new Date(block.endsAt), {
    message: 'startsAt must be before endsAt',
  });

export const listBlocksSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

export const staffServicesSchema = z.object({
  services: z.array(
    z.object({
      serviceId: z.uuid(),
      priceCents: z.number().int().nonnegative().optional(),
      durationMinutes: z.number().int().positive().max(600).optional(),
    }),
  ),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ListStaffInput = z.infer<typeof listStaffSchema>;
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;
export type CreateBlockInput = z.infer<typeof createBlockSchema>;
export type ListBlocksInput = z.infer<typeof listBlocksSchema>;
export type StaffServicesInput = z.infer<typeof staffServicesSchema>;
