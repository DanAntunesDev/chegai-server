import { findOverlap } from './working-hours';

describe('findOverlap', () => {
  it('accepts a split shift with a lunch break', () => {
    expect(
      findOverlap([
        { weekday: 1, start: 540, end: 720 },
        { weekday: 1, start: 780, end: 1140 },
        { weekday: 2, start: 540, end: 1140 },
      ]),
    ).toBeNull();
  });

  it('accepts back to back intervals', () => {
    expect(
      findOverlap([
        { weekday: 3, start: 540, end: 720 },
        { weekday: 3, start: 720, end: 900 },
      ]),
    ).toBeNull();
  });

  it('flags overlapping intervals on the same day', () => {
    const overlap = findOverlap([
      { weekday: 5, start: 780, end: 1080 },
      { weekday: 5, start: 540, end: 800 },
    ]);
    expect(overlap?.map((interval) => interval.start)).toEqual([540, 780]);
  });
});
