import { resolveEntitlements } from './entitlements';

const plan = {
  maxUnits: 1,
  maxBarbers: 3,
  maxReceptionists: 1,
  aiConversationsPerMonth: 0,
  features: ['public_booking', 'whatsapp_reminders', 'unknown_feature'],
};

describe('resolveEntitlements', () => {
  it('uses the plan when there are no overrides', () => {
    const result = resolveEntitlements(plan, null, null);

    expect(result.features).toEqual(['public_booking', 'whatsapp_reminders']);
    expect(result.limits).toEqual({
      units: 1,
      barbers: 3,
      receptionists: 1,
      aiConversationsPerMonth: 0,
    });
  });

  it('enables and disables features per barbershop', () => {
    const result = resolveEntitlements(
      plan,
      { enabled: ['whatsapp_agent'], disabled: ['whatsapp_reminders'] },
      null,
    );

    expect(result.features).toEqual(['public_booking', 'whatsapp_agent']);
  });

  it('overrides limits, including removing a limit with null', () => {
    const result = resolveEntitlements(plan, null, { barbers: 5, units: null });

    expect(result.limits.barbers).toBe(5);
    expect(result.limits.units).toBeNull();
    expect(result.limits.receptionists).toBe(1);
  });
});
