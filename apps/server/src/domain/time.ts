// Time in business days (Mon–Fri). Holidays can be passed as 'YYYY-MM-DD'.
// Used for review age and warnings (e.g. "PR waiting for more than 1 business day").

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Business milliseconds between `from` and `to` (weekends and holidays do not count). */
export function businessMs(from: number, to: number, holidays: ReadonlySet<string> = new Set()): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from;
  while (cursor < to) {
    const d = new Date(cursor);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const next = Math.min(dayStart + DAY, to);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(isoDay(d))) total += next - cursor;
    cursor = next;
  }
  return total;
}

export const businessDays = (from: number, to: number, holidays?: ReadonlySet<string>) => businessMs(from, to, holidays) / DAY;

/** Shifts a timestamp to the team's "local clock" (offset in minutes, e.g. -180 for BRT). */
export const shiftTz = (ts: number, offsetMin: number) => ts + offsetMin * 60_000;
