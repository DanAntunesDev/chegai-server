import { minutesToTime, normalizeBrazilianPhone, timeOfDayField } from './fields';

describe('normalizeBrazilianPhone', () => {
  it.each([
    ['(38) 99746-3513', '+5538997463513'],
    ['38997463513', '+5538997463513'],
    ['+55 38 99746-3513', '+5538997463513'],
    ['3832211234', '+553832211234'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeBrazilianPhone(input)).toBe(expected);
  });

  it.each(['123', '00997463513', '+1 415 555 0100'])('rejects %s', (input) => {
    expect(normalizeBrazilianPhone(input)).toBeNull();
  });
});

describe('time of day', () => {
  it('converts between HH:MM and minutes', () => {
    expect(timeOfDayField.parse('09:30')).toBe(570);
    expect(timeOfDayField.parse('24:00')).toBe(1440);
    expect(minutesToTime(570)).toBe('09:30');
    expect(() => timeOfDayField.parse('9:30')).toThrow();
  });
});
