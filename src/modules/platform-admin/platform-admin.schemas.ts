import { z } from 'zod';
import { featureOverridesSchema, FEATURES, limitOverridesSchema } from '../plans/entitlements';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a hex color like #D62839');
const slug = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and hyphens');
const domain = z
  .string()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'must be a domain like agenda.barbearia.com.br');

export const tenantStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'BLOCKED', 'CANCELED']);

export const createTenantSchema = z.object({
  slug,
  legalName: z.string().min(2),
  displayName: z.string().min(2),
  document: z.string().optional(),
  email: z.email(),
  phone: z.string().optional(),
  timezone: z.string().default('America/Sao_Paulo'),
  planCode: z.string().min(1),
  status: tenantStatusSchema.default('TRIAL'),
  trialDays: z.number().int().min(0).max(90).default(14),
  unit: z.object({
    name: z.string().min(2),
    slug: slug.default('principal'),
    city: z.string().optional(),
    state: z.string().length(2).optional(),
  }),
  owner: z.object({
    email: z.email(),
    name: z.string().min(2),
  }),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    legalName: z.string().min(2),
    displayName: z.string().min(2),
    document: z.string().nullable(),
    email: z.email(),
    phone: z.string().nullable(),
    timezone: z.string(),
    status: tenantStatusSchema,
    planCode: z.string(),
    trialEndsAt: z.iso.datetime().nullable(),
    featureOverrides: featureOverridesSchema.nullable(),
    limitOverrides: limitOverridesSchema.nullable(),
  })
  .partial();

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const updateBrandingSchema = z
  .object({
    primaryColor: hexColor,
    secondaryColor: hexColor,
    allowOwnerRename: z.boolean(),
    customDomain: domain.nullable(),
    showPoweredBy: z.boolean(),
    emailSenderName: z.string().min(2).nullable(),
  })
  .partial();

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

export const updatePlanSchema = z
  .object({
    name: z.string().min(2),
    setupFeeCents: z.number().int().nonnegative(),
    monthlyPriceCents: z.number().int().nonnegative(),
    extraUnitPriceCents: z.number().int().nonnegative(),
    extraUnitSetupFeeCents: z.number().int().nonnegative(),
    maxUnits: z.number().int().positive().nullable(),
    maxBarbers: z.number().int().positive().nullable(),
    maxReceptionists: z.number().int().positive().nullable(),
    aiConversationsPerMonth: z.number().int().nonnegative(),
    features: z.array(z.enum(FEATURES)),
    isActive: z.boolean(),
  })
  .partial();

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const listTenantsSchema = z.object({
  search: z.string().optional(),
  status: tenantStatusSchema.optional(),
});

export type ListTenantsInput = z.infer<typeof listTenantsSchema>;

export const inviteMemberSchema = z.object({
  email: z.email(),
  name: z.string().min(2).optional(),
  roleKey: z.enum(['OWNER', 'MANAGER', 'RECEPTIONIST', 'BARBER']).default('OWNER'),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const brandingAssetSchema = z.enum(['logo', 'logo-dark', 'icon']);

export type BrandingAsset = z.infer<typeof brandingAssetSchema>;
