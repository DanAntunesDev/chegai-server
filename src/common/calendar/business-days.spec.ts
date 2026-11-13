import {
  addBusinessDays,
  fromIsoDate,
  isBusinessDay,
  nationalHolidays,
  nextBusinessDay,
  toIsoDate,
} from './business-days';

describe('business days', () => {
  it('knows the movable national holidays', () => {
    const holidays = nationalHolidays(2026);
    expect(holidays.has('2026-02-16')).toBe(true);
    expect(holidays.has('2026-02-17')).toBe(true);
    expect(holidays.has('2026-04-03')).toBe(true);
    expect(holidays.has('2026-06-04')).toBe(true);
    expect(holidays.has('2026-11-20')).toBe(true);
  });

  it('skips weekends and holidays when counting', () => {
    expect(isBusinessDay(fromIsoDate('2026-11-14'))).toBe(false);
    expect(toIsoDate(addBusinessDays(fromIsoDate('2026-11-13'), 5))).toBe('2026-11-23');
    expect(toIsoDate(nextBusinessDay(fromIsoDate('2026-12-25')))).toBe('2026-12-28');
  });
});
