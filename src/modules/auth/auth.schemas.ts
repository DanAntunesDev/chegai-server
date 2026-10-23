import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  tenantSlug: z.string().min(1).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const switchTenantSchema = z.object({
  tenantSlug: z.string().min(1),
});

export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(2).max(120).optional(),
  password: z.string().min(8).max(128),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
