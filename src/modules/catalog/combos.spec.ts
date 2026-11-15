import { applyCombos, groupCombos } from './combos';

const combos = groupCombos([
  { comboId: 'corte+barba', serviceId: 'corte' },
  { comboId: 'corte+barba', serviceId: 'barba' },
  { comboId: 'completo', serviceId: 'corte' },
  { comboId: 'completo', serviceId: 'barba' },
  { comboId: 'completo', serviceId: 'sobrancelha' },
]);

describe('applyCombos', () => {
  it('swaps services for the combo that contains them', () => {
    expect(applyCombos(['corte', 'barba'], combos)).toEqual(['corte+barba']);
    expect(applyCombos(['barba', 'corte', 'pigmento'], combos)).toEqual([
      'corte+barba',
      'pigmento',
    ]);
  });

  it('prefers the biggest combo', () => {
    expect(applyCombos(['sobrancelha', 'corte', 'barba'], combos)).toEqual(['completo']);
  });

  it('drops services already inside a chosen combo', () => {
    expect(applyCombos(['corte+barba', 'corte'], combos)).toEqual(['corte+barba']);
  });

  it('keeps lone services untouched', () => {
    expect(applyCombos(['corte', 'corte'], combos)).toEqual(['corte']);
    expect(applyCombos(['pigmento'], [])).toEqual(['pigmento']);
  });
});
