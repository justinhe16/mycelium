import { desc, eq, sql } from "drizzle-orm";

import { todayIso } from "./dates";
import type { Db } from "./db/create";
import { accounts, dailySnapshots, holdings, plaidItems, syncRuns, transactions } from "./db/schema";
import { currentTotals, netWorthSeries } from "./net-worth";
import { plaidSettings, setupProblems } from "./plaid";
import type { AccountView, ItemView, Snapshot, SyncRunView } from "./types";

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Everything the page needs except ledger rows, which page separately. Never includes tokens. */
export function loadSnapshot(db: Db, now: Date = new Date()): Snapshot {
  const today = todayIso(now);

  const items: ItemView[] = db
    .select()
    .from(plaidItems)
    .orderBy(plaidItems.institutionName)
    .all()
    .map((i) => ({
      id: i.id,
      institutionName: i.institutionName,
      products: parseJson<string[]>(i.products, []),
      status: i.status,
      errorCode: i.errorCode,
      errorMessage: i.errorMessage,
      createdAt: i.createdAt,
      lastSyncedAt: i.lastSyncedAt,
    }));

  const holdingAgg = new Map(
    db
      .select({ accountId: holdings.accountId, value: sql<number>`sum(${holdings.value})`, n: sql<number>`count(*)` })
      .from(holdings)
      .groupBy(holdings.accountId)
      .all()
      .map((h) => [h.accountId, h]),
  );

  const accountViews: AccountView[] = db
    .select({ a: accounts, institutionName: plaidItems.institutionName })
    .from(accounts)
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.itemId))
    .orderBy(plaidItems.institutionName, accounts.isLiability, accounts.name)
    .all()
    .map(({ a, institutionName }) => ({
      id: a.id,
      itemId: a.itemId,
      institutionName,
      name: a.name,
      officialName: a.officialName,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currentBalance: a.currentBalance,
      availableBalance: a.availableBalance,
      creditLimit: a.creditLimit,
      isoCurrency: a.isoCurrency,
      isLiability: a.isLiability,
      hidden: a.hidden,
      holdingsValue: holdingAgg.get(a.id)?.value ?? null,
      holdingsCount: holdingAgg.get(a.id)?.n ?? 0,
    }));

  const hiddenIds = new Set(accountViews.filter((a) => a.hidden).map((a) => a.id));
  const snapshots = db
    .select({
      day: dailySnapshots.day,
      accountId: dailySnapshots.accountId,
      balance: dailySnapshots.balance,
      isLiability: dailySnapshots.isLiability,
    })
    .from(dailySnapshots)
    .orderBy(dailySnapshots.day)
    .all();

  const categories = db
    .selectDistinct({ c: sql<string>`coalesce(${transactions.categoryPrimary}, 'UNCATEGORIZED')` })
    .from(transactions)
    .all()
    .map((r) => r.c)
    .sort();

  const transactionCount = db.select({ n: sql<number>`count(*)` }).from(transactions).get()!.n;

  const runs: SyncRunView[] = db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.id))
    .limit(15)
    .all()
    .map((r) => {
      const stats = parseJson<{ added?: number; modified?: number; removed?: number }>(r.stats, {});
      return {
        id: r.id,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        trigger: r.trigger,
        status: r.status,
        added: stats.added ?? 0,
        modified: stats.modified ?? 0,
        removed: stats.removed ?? 0,
        error: r.error,
      };
    });

  let env: Snapshot["setup"]["env"] = null;
  try {
    env = plaidSettings()?.env ?? null;
  } catch {
    env = null;
  }

  return {
    today,
    setup: { problems: setupProblems(), env },
    items,
    accounts: accountViews,
    series: netWorthSeries(snapshots, today, hiddenIds),
    totals: currentTotals(accountViews),
    categories,
    transactionCount,
    runs,
  };
}
