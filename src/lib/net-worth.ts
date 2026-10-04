import { addDays, daysBetween } from "./dates";

export type SnapshotRow = { day: string; accountId: string; balance: number; isLiability: boolean };
export type NetWorthPoint = { day: string; assets: number; liabilities: number; netWorth: number; recorded: boolean };

/**
 * Daily net worth from per-account snapshots, from the first recorded day to
 * `today`. Each account carries its last known balance forward across days with
 * no snapshot (a missed sync, or a single item failing), so a gap never reads as
 * a crash to zero. `recorded` marks days with at least one real snapshot.
 */
export function netWorthSeries(rows: SnapshotRow[], today: string, excluded: ReadonlySet<string> = new Set()): NetWorthPoint[] {
  const kept = rows.filter((r) => !excluded.has(r.accountId));
  if (kept.length === 0) return [];

  const byDay = new Map<string, SnapshotRow[]>();
  let first = kept[0].day;
  for (const r of kept) {
    if (r.day < first) first = r.day;
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const last = today > first ? today : first;

  const latest = new Map<string, SnapshotRow>();
  const points: NetWorthPoint[] = [];
  const span = daysBetween(first, last);
  for (let i = 0; i <= span; i++) {
    const day = addDays(first, i);
    const todays = byDay.get(day);
    for (const r of todays ?? []) latest.set(r.accountId, r);
    let assets = 0;
    let liabilities = 0;
    for (const r of latest.values()) {
      if (r.isLiability) liabilities += r.balance;
      else assets += r.balance;
    }
    points.push({ day, assets: round2(assets), liabilities: round2(liabilities), netWorth: round2(assets - liabilities), recorded: !!todays });
  }
  return points;
}

export type BalanceLike = { currentBalance: number | null; isLiability: boolean; hidden: boolean };

export function currentTotals(accounts: BalanceLike[]) {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.hidden || a.currentBalance === null) continue;
    if (a.isLiability) liabilities += a.currentBalance;
    else assets += a.currentBalance;
  }
  return { assets: round2(assets), liabilities: round2(liabilities), netWorth: round2(assets - liabilities) };
}

/** Net worth on or before `day` (the series is dense, so this is an index lookup). */
export function valueOn(series: NetWorthPoint[], day: string): number | null {
  if (series.length === 0 || day < series[0].day) return null;
  const idx = Math.min(daysBetween(series[0].day, day), series.length - 1);
  return series[idx].netWorth;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
