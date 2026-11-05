import { addDays, localDateOf, localMinuteToInstant, weekdayOf } from './zoned-time';

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface StaffSchedule {
  staffId: string;
  durationMinutes: number;
  bufferMinutes: number;
  workingIntervals: { weekday: number; startMinute: number; endMinute: number }[];
  busy: TimeRange[];
}

export interface SlotQuery {
  date: string;
  timeZone: string;
  slotIntervalMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  now: Date;
  staff: StaffSchedule[];
}

export interface Slot {
  startsAt: Date;
  minuteOfDay: number;
  staffIds: string[];
}

function overlaps(range: TimeRange, busy: TimeRange[]): boolean {
  return busy.some((item) => item.start < range.end && range.start < item.end);
}

export function computeSlots(query: SlotQuery): Slot[] {
  const today = localDateOf(query.now, query.timeZone);
  if (query.date < today || query.date > addDays(today, query.maxAdvanceDays)) {
    return [];
  }

  const earliest = new Date(query.now.getTime() + query.minAdvanceMinutes * 60000);
  const weekday = weekdayOf(query.date);
  const slots = new Map<number, Slot>();

  for (const staff of query.staff) {
    for (const interval of staff.workingIntervals.filter((item) => item.weekday === weekday)) {
      const firstStart =
        Math.ceil(interval.startMinute / query.slotIntervalMinutes) * query.slotIntervalMinutes;

      for (
        let minute = firstStart;
        minute + staff.durationMinutes <= interval.endMinute;
        minute += query.slotIntervalMinutes
      ) {
        const start = localMinuteToInstant(query.date, minute, query.timeZone);
        if (start < earliest) {
          continue;
        }

        const occupied = {
          start,
          end: new Date(start.getTime() + (staff.durationMinutes + staff.bufferMinutes) * 60000),
        };
        if (overlaps(occupied, staff.busy)) {
          continue;
        }

        const slot = slots.get(minute) ?? { startsAt: start, minuteOfDay: minute, staffIds: [] };
        slot.staffIds.push(staff.staffId);
        slots.set(minute, slot);
      }
    }
  }

  return [...slots.values()].sort((a, b) => a.minuteOfDay - b.minuteOfDay);
}
