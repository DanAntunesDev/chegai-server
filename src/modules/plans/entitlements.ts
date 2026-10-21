import { z } from 'zod';

export const FEATURES = [
  'public_booking',
  'whatsapp_reminders',
  'whatsapp_agent',
  'deposits',
  'waitlist',
  'custom_domain',
  'basic_dashboard',
  'full_dashboard',
  'unit_comparison',
  'loyalty',
  'products',
  'hide_powered_by',
] as const;

export type Feature = (typeof FEATURES)[number];

export const featureOverridesSchema = z.object({
  enabled: z.array(z.enum(FEATURES)).default([]),
  disabled: z.array(z.enum(FEATURES)).default([]),
});

export const limitOverridesSchema = z.object({
  units: z.number().int().positive().nullable().optional(),
  barbers: z.number().int().positive().nullable().optional(),
  receptionists: z.number().int().positive().nullable().optional(),
  aiConversationsPerMonth: z.number().int().nonnegative().optional(),
});

export type FeatureOverrides = z.infer<typeof featureOverridesSchema>;
export type LimitOverrides = z.infer<typeof limitOverridesSchema>;

export interface PlanLimits {
  maxUnits: number | null;
  maxBarbers: number | null;
  maxReceptionists: number | null;
  aiConversationsPerMonth: number;
  features: string[];
}

export interface Entitlements {
  features: Feature[];
  limits: {
    units: number | null;
    barbers: number | null;
    receptionists: number | null;
    aiConversationsPerMonth: number;
  };
}

function isFeature(value: string): value is Feature {
  return (FEATURES as readonly string[]).includes(value);
}

export function resolveEntitlements(
  plan: PlanLimits,
  rawFeatureOverrides: unknown,
  rawLimitOverrides: unknown,
): Entitlements {
  const featureOverrides = featureOverridesSchema.parse(rawFeatureOverrides ?? {});
  const limitOverrides = limitOverridesSchema.parse(rawLimitOverrides ?? {});

  const features = new Set<Feature>(plan.features.filter(isFeature));
  featureOverrides.enabled.forEach((feature) => features.add(feature));
  featureOverrides.disabled.forEach((feature) => features.delete(feature));

  return {
    features: FEATURES.filter((feature) => features.has(feature)),
    limits: {
      units: limitOverrides.units !== undefined ? limitOverrides.units : plan.maxUnits,
      barbers: limitOverrides.barbers !== undefined ? limitOverrides.barbers : plan.maxBarbers,
      receptionists:
        limitOverrides.receptionists !== undefined
          ? limitOverrides.receptionists
          : plan.maxReceptionists,
      aiConversationsPerMonth:
        limitOverrides.aiConversationsPerMonth ?? plan.aiConversationsPerMonth,
    },
  };
}
