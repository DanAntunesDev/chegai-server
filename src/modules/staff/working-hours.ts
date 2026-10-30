export interface Interval {
  weekday: number;
  start: number;
  end: number;
}

export function findOverlap<T extends Interval>(intervals: T[]): [T, T] | null {
  const sorted = [...intervals].sort((a, b) => a.weekday - b.weekday || a.start - b.start);

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.weekday === current.weekday && current.start < previous.end) {
      return [previous, current];
    }
  }

  return null;
}
