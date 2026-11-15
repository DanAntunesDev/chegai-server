import { amountFor } from './booking-payments.service';

describe('booking payment amounts', () => {
  it('charges the deposit share, the full price or what is left', () => {
    expect(amountFor('DEPOSIT', 5000, 0, 50)).toBe(2500);
    expect(amountFor('DEPOSIT', 4500, 0, 30)).toBe(1350);
    expect(amountFor('FULL', 5000, 0, 50)).toBe(5000);
    expect(amountFor('REMAINDER', 5000, 2000, 50)).toBe(3000);
    expect(amountFor('REMAINDER', 5000, 6000, 50)).toBe(0);
  });
});
