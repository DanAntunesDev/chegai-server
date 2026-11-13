import { z } from 'zod';

export const summaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM'),
  unitId: z.uuid().optional(),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
