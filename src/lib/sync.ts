import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { AccountBase, Holding, Security, Transaction, RemovedTransaction } from "plaid";

import { classify, isLiabilityType, normalizeAmount } from "./classify";
import { todayIso } from "./dates";
import type { Db } from "./db/create";
import { accounts, dailySnapshots, holdings, plaidItems, syncRuns, transactions } from "./db/schema";
import { describeError, plaidError, RELINK_CODES, type PlaidClient } from "./plaid";

/*
 * Pull-only sync. Localhost can't receive Plaid webhooks, so every run asks each
 * Item for its accounts, a /transactions/sync delta from the stored cursor, and
 * investment holdings, then records today's balance for every account.
 *
 * Plaid is injected so tests can drive this against a fake and an in-memory DB.
 */

export type SyncTrigger = (typeof syncRuns.$inferInsert)["trigger"];

export type SyncDeps = {
  db: Db;
  plaid: Pick<PlaidClient, "accountsGet" | "transactionsSync" | "investmentsHoldingsGet" | "itemGet">;
  decrypt: (ciphertext: string) => string;
  now?: () => Date;
};

export type ItemResult = {
  itemId: string;
  institution: string;
  status: "ok" | "login_required" | "error";
  error?: string;
  accounts: number;
  added: number;
  modified: number;
  removed: number;
  holdings: number;
};

export type SyncSummary =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      runId: number;
      status: "ok" | "partial" | "error";
      items: ItemResult[];
      snapshotDay: string;
      snapshotAccounts: number;
      reclassified: number;
      unmatched: number;
    };

/** A run stuck in "running" longer than this is presumed dead (crashed process) and ignored. */
const STALE_RUN_MS = 10 * 60_000;
const MAX_PAGINATION_RESTARTS = 3;

export async function runSync(deps: SyncDeps, trigger: SyncTrigger, opts: { itemIds?: string[] } = {}): Promise<SyncSummary> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();

  // One sync at a time across processes (dev server + launchd share the DB file).
  const cutoff = new Date(now().getTime() - STALE_RUN_MS).toISOString();
  const active = db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "running"), gt(syncRuns.startedAt, cutoff)))
    .get();
  if (active) return { skipped: true, reason: "Another sync is already running." };

  const runId = db.insert(syncRuns).values({ startedAt, trigger, status: "running" }).returning({ id: syncRuns.id }).get().id;

  try {
    const itemRows = opts.itemIds?.length
      ? db.select().from(plaidItems).where(inArray(plaidItems.id, opts.itemIds)).all()
      : db.select().from(plaidItems).all();

    const items: ItemResult[] = [];
    for (const item of itemRows) items.push(await syncItem(deps, item));

    // Re-apply the classification rules to every stored row (so a rule change, or a row
    // stored under older rules, is fixed on the next sync), then pair card payments.
    const reclassified = reclassifyAll(db);
    const unmatched = pairCardPayments(db);

    const snapshotDay = todayIso(now());
    const snapshotAccounts = recordSnapshot(db, snapshotDay, now().toISOString());

    const failed = items.filter((i) => i.status !== "ok").length;
    const status = failed === 0 ? "ok" : failed === items.length ? "error" : "partial";
    const totals = items.reduce(
      (t, i) => ({
        added: t.added + i.added,
        modified: t.modified + i.modified,
        removed: t.removed + i.removed,
        accounts: t.accounts + i.accounts,
        holdings: t.holdings + i.holdings,
      }),
      { added: 0, modified: 0, removed: 0, accounts: 0, holdings: 0 },
    );
    db.update(syncRuns)
      .set({
        finishedAt: now().toISOString(),
        status,
        stats: JSON.stringify({
          ...totals,
          snapshotDay,
          snapshotAccounts,
          reclassified,
          unmatched,
          items: items.map((i) => ({ id: i.itemId, institution: i.institution, status: i.status, error: i.error })),
        }),
        error: failed ? items.filter((i) => i.error).map((i) => `${i.institution}: ${i.error}`).join("; ") : null,
      })
      .where(eq(syncRuns.id, runId))
      .run();

    return { skipped: false, runId, status, items, snapshotDay, snapshotAccounts, reclassified, unmatched };
  } catch (err) {
    db.update(syncRuns)
      .set({ finishedAt: now().toISOString(), status: "error", error: describeError(err) })
      .where(eq(syncRuns.id, runId))
      .run();
    throw err;
  }
}

type ItemRow = typeof plaidItems.$inferSelect;

export async function syncItem(deps: SyncDeps, item: ItemRow): Promise<ItemResult> {
  const { db, plaid } = deps;
  const nowIso = () => (deps.now ?? (() => new Date()))().toISOString();
  const result: ItemResult = {
    itemId: item.id,
    institution: item.institutionName,
    status: "ok",
    accounts: 0,
    added: 0,
    modified: 0,
    removed: 0,
    holdings: 0,
  };

  try {
    const accessToken = deps.decrypt(item.accessTokenEnc);

    const itemInfo = (await plaid.itemGet({ access_token: accessToken })).data.item;
    const products = new Set<string>([...(itemInfo.products ?? []), ...(itemInfo.billed_products ?? [])]);
    db.update(plaidItems).set({ products: JSON.stringify([...products].sort()) }).where(eq(plaidItems.id, item.id)).run();

    const accountList = (await plaid.accountsGet({ access_token: accessToken })).data.accounts;
    upsertAccounts(db, item.id, accountList, nowIso());
    result.accounts = accountList.length;

    if (products.has("transactions")) {
      const delta = await pullTransactions(plaid, accessToken, item.txCursor);
      if (delta) {
        const counts = applyTransactions(db, item.id, delta, nowIso());
        Object.assign(result, counts);
      }
    }

    if (products.has("investments")) {
      result.holdings = await pullHoldings(deps, accessToken, nowIso());
    }

    db.update(plaidItems)
      .set({ status: "ok", errorCode: null, errorMessage: null, lastSyncedAt: nowIso() })
      .where(eq(plaidItems.id, item.id))
      .run();
  } catch (err) {
    const p = plaidError(err);
    result.status = p && RELINK_CODES.has(p.code) ? "login_required" : "error";
    result.error = describeError(err);
    db.update(plaidItems)
      .set({ status: result.status, errorCode: p?.code ?? null, errorMessage: p?.message ?? result.error })
      .where(eq(plaidItems.id, item.id))
      .run();
  }
  return result;
}

export function upsertAccounts(db: Db, itemId: string, list: AccountBase[], nowIso: string) {
  db.transaction((tx) => {
    for (const a of list) {
      const values = {
        name: a.name,
        officialName: a.official_name ?? null,
        mask: a.mask ?? null,
        type: String(a.type),
        subtype: a.subtype ? String(a.subtype) : null,
        currentBalance: a.balances.current ?? null,
        availableBalance: a.balances.available ?? null,
        creditLimit: a.balances.limit ?? null,
        isoCurrency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? null,
        isLiability: isLiabilityType(String(a.type)),
        updatedAt: nowIso,
      };
      // `hidden` is the user's choice and survives every sync.
      tx.insert(accounts)
        .values({ id: a.account_id, itemId, ...values })
        .onConflictDoUpdate({ target: accounts.id, set: values })
        .run();
    }
  });
}

type TransactionsDelta = { added: Transaction[]; modified: Transaction[]; removed: RemovedTransaction[]; cursor: string };

const SKIPPABLE_PRODUCT_CODES = new Set(["PRODUCT_NOT_READY", "PRODUCTS_NOT_SUPPORTED", "NO_ACCOUNTS", "NO_INVESTMENT_ACCOUNTS", "NO_INVESTMENT_AUTH_ACCOUNTS"]);

/** Page through /transactions/sync. Returns null when the product isn't ready yet (fresh Items). */
async function pullTransactions(
  plaid: SyncDeps["plaid"],
  accessToken: string,
  startCursor: string | null,
): Promise<TransactionsDelta | null> {
  for (let attempt = 0; attempt <= MAX_PAGINATION_RESTARTS; attempt++) {
    const delta: TransactionsDelta = { added: [], modified: [], removed: [], cursor: startCursor ?? "" };
    let cursor = startCursor ?? undefined;
    let hasMore = true;
    try {
      while (hasMore) {
        const { data } = await plaid.transactionsSync({ access_token: accessToken, cursor, count: 500 });
        delta.added.push(...data.added);
        delta.modified.push(...data.modified);
        delta.removed.push(...data.removed);
        cursor = data.next_cursor;
        hasMore = data.has_more;
      }
      delta.cursor = cursor ?? "";
      return delta;
    } catch (err) {
      const code = plaidError(err)?.code;
      // Plaid's documented recovery: restart the whole pagination from the original cursor.
      if (code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      if (code && SKIPPABLE_PRODUCT_CODES.has(code)) return null;
      throw err;
    }
  }
  throw new Error("Transactions kept changing during sync; try again in a minute.");
}

export function applyTransactions(db: Db, itemId: string, delta: TransactionsDelta, nowIso: string) {
  const known = new Map(
    db
      .select({ id: accounts.id, type: accounts.type, subtype: accounts.subtype })
      .from(accounts)
      .where(eq(accounts.itemId, itemId))
      .all()
      .map((r) => [r.id, { accountType: r.type, accountSubtype: r.subtype }]),
  );
  let added = 0;
  let modified = 0;
  let removed = 0;

  db.transaction((tx) => {
    const upserts = [
      ...delta.added.map((t) => ({ t, isNew: true })),
      ...delta.modified.map((t) => ({ t, isNew: false })),
    ];
    for (const { t, isNew } of upserts) {
      const account = known.get(t.account_id);
      if (!account) continue;
      const amount = normalizeAmount(t.amount);
      const primary = t.personal_finance_category?.primary ?? null;
      const detailed = t.personal_finance_category?.detailed ?? null;
      const { kind, tag } = classify(amount, primary, detailed, account);
      const values = {
        accountId: t.account_id,
        date: t.date,
        authorizedDate: t.authorized_date ?? null,
        name: t.name ?? t.merchant_name ?? "Unknown",
        merchantName: t.merchant_name ?? null,
        amount,
        isoCurrency: t.iso_currency_code ?? t.unofficial_currency_code ?? null,
        pending: t.pending,
        categoryPrimary: primary,
        categoryDetailed: detailed,
        paymentChannel: t.payment_channel ? String(t.payment_channel) : null,
        kind,
        transferTag: tag,
        updatedAt: nowIso,
      };
      const res = tx
        .insert(transactions)
        .values({ id: t.transaction_id, ...values, createdAt: nowIso })
        .onConflictDoUpdate({ target: transactions.id, set: values })
        .run();
      if (res.changes) {
        if (isNew) added++;
        else modified++;
      }
    }
    const removedIds = delta.removed.map((r) => r.transaction_id).filter(Boolean) as string[];
    for (let i = 0; i < removedIds.length; i += 500) {
      removed += tx.delete(transactions).where(inArray(transactions.id, removedIds.slice(i, i + 500))).run().changes;
    }
    tx.update(plaidItems).set({ txCursor: delta.cursor }).where(eq(plaidItems.id, itemId)).run();
  });

  return { added, modified, removed };
}

/**
 * Re-run `classify` over every stored transaction and write back the rows whose kind or
 * transfer tag changed. Idempotent: a second run changes nothing. Returns rows changed.
 */
export function reclassifyAll(db: Db): number {
  const rows = db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      primary: transactions.categoryPrimary,
      detailed: transactions.categoryDetailed,
      kind: transactions.kind,
      tag: transactions.transferTag,
      accountType: accounts.type,
      accountSubtype: accounts.subtype,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .all();
  let changed = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      const c = classify(r.amount, r.primary, r.detailed, { accountType: r.accountType, accountSubtype: r.accountSubtype });
      if (c.kind === r.kind && c.tag === r.tag) continue;
      tx.update(transactions).set({ kind: c.kind, transferTag: c.tag }).where(eq(transactions.id, r.id)).run();
      changed++;
    }
  });
  return changed;
}

/** How far apart (days) the two sides of a card payment may post. */
export const PAIR_WINDOW_DAYS = 5;

const dayNumber = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const cents = (x: number) => Math.round(x * 100);

/**
 * Flag card payments that leave a bank account with nothing arriving on a linked card or
 * loan: an equal, opposite amount on a credit/loan account within PAIR_WINDOW_DAYS. Each
 * receipt pairs with at most one payment (closest date first). Pending payments are never
 * flagged; their other side may simply not have posted yet. Recomputed from scratch every
 * sync, so it is idempotent. Returns how many payments are unmatched.
 */
export function pairCardPayments(db: Db): number {
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      pending: transactions.pending,
      tag: transactions.transferTag,
      unmatched: transactions.unmatched,
      accountType: accounts.type,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .orderBy(transactions.date, transactions.id)
    .all();

  // Receipts on liability accounts, by amount in cents, each with a "used" flag.
  const receipts = new Map<number, { day: number; used: boolean }[]>();
  for (const r of rows) {
    if (r.amount > 0 && isLiabilityType(r.accountType)) {
      const k = cents(r.amount);
      const list = receipts.get(k) ?? [];
      list.push({ day: dayNumber(r.date), used: false });
      receipts.set(k, list);
    }
  }

  const want = new Map<string, boolean>();
  for (const r of rows) {
    if (r.tag !== "card_payment" || r.amount >= 0 || isLiabilityType(r.accountType) || r.pending) continue;
    const day = dayNumber(r.date);
    let best: { day: number; used: boolean } | null = null;
    for (const c of receipts.get(cents(-r.amount)) ?? []) {
      if (c.used || Math.abs(c.day - day) > PAIR_WINDOW_DAYS) continue;
      if (!best || Math.abs(c.day - day) < Math.abs(best.day - day)) best = c;
    }
    if (best) best.used = true;
    else want.set(r.id, true);
  }

  db.transaction((tx) => {
    for (const r of rows) {
      const flag = want.get(r.id) ?? false;
      if (flag !== r.unmatched) tx.update(transactions).set({ unmatched: flag }).where(eq(transactions.id, r.id)).run();
    }
  });
  return want.size;
}

async function pullHoldings(deps: SyncDeps, accessToken: string, nowIso: string): Promise<number> {
  let data;
  try {
    data = (await deps.plaid.investmentsHoldingsGet({ access_token: accessToken })).data;
  } catch (err) {
    const code = plaidError(err)?.code;
    if (code && SKIPPABLE_PRODUCT_CODES.has(code)) return 0;
    throw err;
  }
  return replaceHoldings(deps.db, data.accounts.map((a) => a.account_id), data.holdings, data.securities, nowIso);
}

export function replaceHoldings(db: Db, accountIds: string[], list: Holding[], securities: Security[], nowIso: string) {
  const bySecurity = new Map(securities.map((s) => [s.security_id, s]));
  let count = 0;
  db.transaction((tx) => {
    if (accountIds.length) tx.delete(holdings).where(inArray(holdings.accountId, accountIds)).run();
    for (const h of list) {
      if (!accountIds.includes(h.account_id)) continue;
      const s = bySecurity.get(h.security_id);
      tx.insert(holdings)
        .values({
          accountId: h.account_id,
          securityId: h.security_id,
          ticker: s?.ticker_symbol ?? null,
          name: s?.name ?? null,
          securityType: s?.type ?? null,
          quantity: h.quantity,
          price: h.institution_price ?? null,
          value: h.institution_value,
          costBasis: h.cost_basis ?? null,
          isoCurrency: h.iso_currency_code ?? h.unofficial_currency_code ?? null,
          asOf: h.institution_price_as_of ?? nowIso.slice(0, 10),
        })
        .onConflictDoNothing()
        .run();
      count++;
    }
  });
  return count;
}

/**
 * Record every account's current balance for `day`. A later sync the same day
 * overwrites it, so the snapshot is always the freshest value seen that day.
 * Accounts whose Item failed keep their last known balance (carry-forward).
 */
export function recordSnapshot(db: Db, day: string, nowIso: string): number {
  const rows = db
    .select({ id: accounts.id, balance: accounts.currentBalance, isLiability: accounts.isLiability })
    .from(accounts)
    .all()
    .filter((a) => a.balance !== null);
  db.transaction((tx) => {
    for (const a of rows) {
      tx.insert(dailySnapshots)
        .values({ day, accountId: a.id, balance: a.balance!, isLiability: a.isLiability, recordedAt: nowIso })
        .onConflictDoUpdate({
          target: [dailySnapshots.day, dailySnapshots.accountId],
          set: { balance: a.balance!, isLiability: a.isLiability, recordedAt: nowIso },
        })
        .run();
    }
  });
  return rows.length;
}

/** True if a sync finished today (local day) -- used by the catch-up-on-boot check. */
export function hasSnapshotFor(db: Db, day: string): boolean {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(dailySnapshots)
      .where(eq(dailySnapshots.day, day))
      .get()!.n > 0
  );
}
