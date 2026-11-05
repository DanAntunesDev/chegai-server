import { computeSlots, type StaffSchedule } from './slots';
import { localMinuteToInstant, weekdayOf } from './zoned-time';

const TZ = 'America/Sao_Paulo';
const DATE = '2026-12-01';
const at = (minute: number) => localMinuteToInstant(DATE, minute, TZ);
const hm = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

function barber(overrides: Partial<StaffSchedule> = {}): StaffSchedule {
  return {
    staffId: 'joao',
    durationMinutes: 30,
    bufferMinutes: 0,
    workingIntervals: [
      { weekday: weekdayOf(DATE), startMinute: hm('09:00'), endMinute: hm('11:00') },
    ],
    busy: [],
    ...overrides,
  };
}

const baseQuery = {
  date: DATE,
  timeZone: TZ,
  slotIntervalMinutes: 30,
  minAdvanceMinutes: 0,
  maxAdvanceDays: 30,
  now: new Date('2026-11-30T12:00:00Z'),
};

const times = (slots: ReturnType<typeof computeSlots>) =>
  slots.map(
    (slot) =>
      `${Math.floor(slot.minuteOfDay / 60)}:${String(slot.minuteOfDay % 60).padStart(2, '0')}`,
  );

describe('computeSlots', () => {
  it('converts local times in Sao Paulo to UTC', () => {
    expect(at(hm('09:00')).toISOString()).toBe('2026-12-01T12:00:00.000Z');
  });

  it('offers every slot that fits inside working hours', () => {
    const slots = computeSlots({ ...baseQuery, staff: [barber()] });
    expect(times(slots)).toEqual(['9:00', '9:30', '10:00', '10:30']);
  });

  it('does not offer a service that would end after closing', () => {
    const slots = computeSlots({ ...baseQuery, staff: [barber({ durationMinutes: 50 })] });
    expect(times(slots)).toEqual(['9:00', '9:30', '10:00']);
  });

  it('respects bookings and the cleaning buffer', () => {
    const slots = computeSlots({
      ...baseQuery,
      staff: [
        barber({
          bufferMinutes: 10,
          busy: [{ start: at(hm('10:00')), end: at(hm('10:40')) }],
        }),
      ],
    });
    expect(times(slots)).toEqual(['9:00']);
  });

  it('skips schedule blocks such as lunch breaks', () => {
    const slots = computeSlots({
      ...baseQuery,
      staff: [barber({ busy: [{ start: at(hm('09:30')), end: at(hm('10:30')) }] })],
    });
    expect(times(slots)).toEqual(['9:00', '10:30']);
  });

  it('applies the minimum advance and the booking window', () => {
    const now = at(hm('09:10'));
    expect(
      times(computeSlots({ ...baseQuery, now, minAdvanceMinutes: 30, staff: [barber()] })),
    ).toEqual(['10:00', '10:30']);
    expect(computeSlots({ ...baseQuery, maxAdvanceDays: 0, staff: [barber()] })).toEqual([]);
    expect(
      computeSlots({ ...baseQuery, now: new Date('2026-12-02T12:00:00Z'), staff: [barber()] }),
    ).toEqual([]);
  });

  it('merges barbers that share the same time', () => {
    const slots = computeSlots({
      ...baseQuery,
      staff: [
        barber(),
        barber({ staffId: 'pedro', busy: [{ start: at(hm('09:00')), end: at(hm('10:00')) }] }),
      ],
    });
    expect(slots[0].staffIds).toEqual(['joao']);
    expect(slots[2].staffIds).toEqual(['joao', 'pedro']);
  });

  it('aligns odd working hours to the slot grid', () => {
    const slots = computeSlots({
      ...baseQuery,
      staff: [
        barber({
          workingIntervals: [
            { weekday: weekdayOf(DATE), startMinute: hm('09:10'), endMinute: hm('10:30') },
          ],
        }),
      ],
    });
    expect(times(slots)).toEqual(['9:30', '10:00']);
  });
});
