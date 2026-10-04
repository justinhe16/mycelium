/**
 * Calendar-day helpers over `YYYY-MM-DD` strings. Arithmetic runs in UTC so a
 * DST shift can never turn "add one day" into 23 or 25 hours.
 */

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today in the machine's local time zone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, n: number): string {
  return fromMs(toMs(day) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (new Date(toMs(day)).getUTCDay() + 6) % 7;
}

/** The Monday that starts `day`'s week. */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatDay(day: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = day.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  const withYear = opts.year ? `${base}, ${y}` : base;
  return opts.weekday ? `${WEEKDAYS[weekdayIndex(day)]}, ${withYear}` : withYear;
}

export function monthLabel(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
