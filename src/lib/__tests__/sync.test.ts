import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db/create";
import { dailySnapshots, holdings, plaidItems, syncRuns, transactions } from "../db/schema";
import { queryLedger } from "../ledger";
import { DEFAULT_QUERY } from "../ledger-query";
import { loadSnapshot } from "../queries";
import { runSync, type SyncDeps } from "../sync";

/* A fake Plaid that serves scripted /transactions/sync pages. */

type Page = { added?: object[]; modified?: object[]; removed?: object[]; next_cursor: string; has_more: boolean };

function plaidErr(code: string) {
  return Object.assign(new Error(code), { response: { data: { error_code: code, error_type: "ITEM_ERROR", error_message: code } } });
}

function account(id: string, type: string, current: number, extra: object = {}) {
  return { account_id: id, name: id.toUpperCase(), mask: "0000", type, subtype: null, balances: { current, available: null, limit: null, iso_currency_code: "USD" }, ...extra };
}

function txn(id: string, accountId: string, plaidAmount: number, date: string, primary: string | null, detailed: string | null = null, extra: object = {}) {
  return {
    transaction_id: id,
    account_id: accountId,
    amount: plaidAmount,
    date,
    name: `${id} raw`,
    merchant_name: null,
    pending: false,
    iso_currency_code: "USD",
    payment_channel: "online",
    personal_finance_category: primary ? { primary, detailed: detailed ?? `${primary}_OTHER` } : null,
    ...extra,
  };
}

class FakePlaid {
  products = ["transactions"];
  accounts: object[] = [account("chk", "depository", 1000), account("card", "credit", 200)];
  pages = new Map<string, Page>(); // cursor ("" for first) -> page
  failNextSyncWith: string | null = null;
  failItemWith: string | null = null;
  holdingsData = { accounts: [] as object[], holdings: [] as object[], securities: [] as object[] };

  itemGet = async () => {
    if (this.failItemWith) throw plaidErr(this.failItemWith);
    return { data: { item: { products: this.products, billed_products: [] } } };
  };
  accountsGet = async () => ({ data: { accounts: this.accounts } });
  transactionsSync = async ({ cursor }: { cursor?: string }) => {
    if (this.failNextSyncWith) {
      const code = this.failNextSyncWith;
      this.failNextSyncWith = null;
      throw plaidErr(code);
    }
    const page = this.pages.get(cursor ?? "") ?? { next_cursor: cursor ?? "", has_more: false };
    return { data: { added: [], modified: [], removed: [], ...page } };
  };
  investmentsHoldingsGet = async () => ({ data: this.holdingsData });
}

let db: Db;
let plaid: FakePlaid;
let clock: Date;

function deps(): SyncDeps {
  return { db, plaid: plaid as unknown as SyncDeps["plaid"], decrypt: (s) => s.replace(/^enc:/, ""), now: () => clock };
}

beforeEach(() => {
  db = createDb(":memory:");
  plaid = new FakePlaid();
  clock = new Date(2026, 0, 15, 9, 0, 0); // local Jan 15
  db.insert(plaidItems)
    .values({ id: "item1", institutionName: "Chase", accessTokenEnc: "enc:token", createdAt: clock.toISOString() })
    .run();
});

describe("runSync", () => {
  it("pulls accounts and paginated transactions, normalizes, classifies and snapshots", async () => {
    plaid.pages.set("", {
      added: [txn("t1", "chk", -2500, "2026-01-02", "INCOME", "INCOME_WAGES"), txn("t2", "card", 42.1, "2026-01-03", "FOOD_AND_DRINK")],
      next_cursor: "c1",
      has_more: true,
    });
    plaid.pages.set("c1", {
      added: [txn("t3", "chk", 200, "2026-01-04", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")],
      next_cursor: "c2",
      has_more: false,
    });

    const res = await runSync(deps(), "manual");
    expect(res.skipped).toBe(false);
    if (res.skipped) return;
    expect(res.status).toBe("ok");
    expect(res.items[0]).toMatchObject({ added: 3, accounts: 2, status: "ok" });
    expect(res.snapshotDay).toBe("2026-01-15");

    const rows = db.select().from(transactions).all();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.t1).toMatchObject({ amount: 2500, kind: "income" });
    expect(byId.t2).toMatchObject({ amount: -42.1, kind: "spend" });
    expect(byId.t3).toMatchObject({ amount: -200, kind: "transfer" });

    expect(db.select().from(plaidItems).get()!.txCursor).toBe("c2");
    expect(db.select().from(dailySnapshots).all()).toHaveLength(2);

    const snap = loadSnapshot(db, clock);
    expect(snap.totals).toEqual({ assets: 1000, liabilities: 200, netWorth: 800 });
    expect(snap.series).toEqual([{ day: "2026-01-15", assets: 1000, liabilities: 200, netWorth: 800, recorded: true }]);
    expect(JSON.stringify(snap)).not.toContain("token");
  });

  it("applies modified and removed deltas from the stored cursor, idempotently", async () => {
    plaid.pages.set("", { added: [txn("p1", "card", 10, "2026-01-10", "FOOD_AND_DRINK", null, { pending: true })], next_cursor: "c1", has_more: false });
    await runSync(deps(), "manual");

    // Pending settles: Plaid removes the pending row and adds the posted one; another is amended.
    plaid.pages.set("c1", {
      added: [txn("p1-posted", "card", 12, "2026-01-11", "FOOD_AND_DRINK")],
      removed: [{ transaction_id: "p1", account_id: "card" }],
      next_cursor: "c2",
      has_more: false,
    });
    const res = await runSync(deps(), "manual");
    if (res.skipped) throw new Error("skipped");
    expect(res.items[0]).toMatchObject({ added: 1, removed: 1 });
    expect(db.select({ id: transactions.id, amount: transactions.amount }).from(transactions).all()).toEqual([{ id: "p1-posted", amount: -12 }]);

    plaid.pages.set("c2", { modified: [txn("p1-posted", "card", 15, "2026-01-11", "FOOD_AND_DRINK")], next_cursor: "c3", has_more: false });
    await runSync(deps(), "manual");
    // Running again with nothing new changes nothing.
    await runSync(deps(), "manual");
    expect(db.select({ amount: transactions.amount }).from(transactions).all()).toEqual([{ amount: -15 }]);
  });

  it("restarts pagination when Plaid reports a mutation mid-sync", async () => {
    plaid.pages.set("", { added: [txn("t1", "chk", -5, "2026-01-02", "INCOME")], next_cursor: "c1", has_more: false });
    plaid.failNextSyncWith = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
    const res = await runSync(deps(), "manual");
    if (res.skipped) throw new Error("skipped");
    expect(res.status).toBe("ok");
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it("treats PRODUCT_NOT_READY as nothing-yet, not an error", async () => {
    plaid.failNextSyncWith = "PRODUCT_NOT_READY";
    const res = await runSync(deps(), "manual");
    if (res.skipped) throw new Error("skipped");
    expect(res.status).toBe("ok");
    expect(db.select().from(plaidItems).get()!.txCursor).toBeNull();
  });

  it("marks a login that needs re-auth, and still snapshots last known balances", async () => {
    await runSync(deps(), "manual");
    clock = new Date(2026, 0, 16, 9);
    plaid.failItemWith = "ITEM_LOGIN_REQUIRED";
    const res = await runSync(deps(), "launchd");
    if (res.skipped) throw new Error("skipped");
    expect(res.status).toBe("error");
    expect(db.select().from(plaidItems).get()).toMatchObject({ status: "login_required", errorCode: "ITEM_LOGIN_REQUIRED" });
    // Carry-forward: Jan 16 still records the balances seen on Jan 15.
    expect(db.select().from(dailySnapshots).where(eq(dailySnapshots.day, "2026-01-16")).all()).toHaveLength(2);
    const run = db.select().from(syncRuns).where(eq(syncRuns.id, res.runId)).get()!;
    expect(run.error).toContain("ITEM_LOGIN_REQUIRED");
  });

  it("overwrites today's snapshot on a second sync, and keeps hidden choices", async () => {
    await runSync(deps(), "manual");
    db.run(sql`update accounts set hidden = 1 where id = 'card'`);
    plaid.accounts = [account("chk", "depository", 1500), account("card", "credit", 999)];
    await runSync(deps(), "manual");
    const snaps = db.select().from(dailySnapshots).all();
    expect(snaps).toHaveLength(2);
    expect(snaps.find((s) => s.accountId === "chk")!.balance).toBe(1500);
    const snap = loadSnapshot(db, clock);
    expect(snap.accounts.find((a) => a.id === "card")!.hidden).toBe(true);
    expect(snap.totals.netWorth).toBe(1500);
    expect(snap.series.at(-1)!.netWorth).toBe(1500);
  });

  it("refuses to start while another sync is running", async () => {
    db.insert(syncRuns).values({ startedAt: clock.toISOString(), trigger: "launchd", status: "running" }).run();
    expect(await runSync(deps(), "manual")).toMatchObject({ skipped: true });
    // ...unless that run is stale (a crashed process).
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect(await runSync(deps(), "manual")).toMatchObject({ skipped: false });
  });

  it("stores investment holdings with their securities", async () => {
    plaid.products = ["investments"];
    plaid.accounts = [account("ira", "investment", 5000)];
    plaid.holdingsData = {
      accounts: [account("ira", "investment", 5000)],
      holdings: [{ account_id: "ira", security_id: "s1", quantity: 10, institution_price: 500, institution_value: 5000, cost_basis: 4000, iso_currency_code: "USD" }],
      securities: [{ security_id: "s1", ticker_symbol: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf" }],
    };
    const res = await runSync(deps(), "manual");
    if (res.skipped) throw new Error("skipped");
    expect(res.items[0].holdings).toBe(1);
    expect(db.select().from(holdings).get()).toMatchObject({ ticker: "VTI", value: 5000, quantity: 10 });
  });
});

describe("ledger + views", () => {
  beforeEach(async () => {
    plaid.pages.set("", {
      added: [
        txn("a", "chk", -3000, "2026-01-01", "INCOME", "INCOME_WAGES"),
        txn("b", "card", 25, "2026-01-05", "FOOD_AND_DRINK", null, { merchant_name: "Blue Bottle" }),
        txn("c", "card", 80, "2026-01-07", "GENERAL_MERCHANDISE"),
        txn("d", "chk", 105, "2026-02-01", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
        txn("e", "card", -10, "2026-02-02", null, null, { name: "100% refund_thing" }),
      ],
      next_cursor: "c1",
      has_more: false,
    });
    await runSync(deps(), "manual");
  });

  it("filters, sorts, pages and totals", () => {
    const all = queryLedger(db, DEFAULT_QUERY);
    expect(all.total).toBe(5);
    expect(all.rows.map((r) => r.id)).toEqual(["e", "d", "c", "b", "a"]);
    expect(all.inflow).toBe(3010);
    expect(all.outflow).toBe(210);

    const spend = queryLedger(db, { ...DEFAULT_QUERY, kinds: ["spend"], sort: "amount", dir: "asc" });
    expect(spend.rows.map((r) => r.id)).toEqual(["c", "b"]);

    const card = queryLedger(db, { ...DEFAULT_QUERY, accounts: ["card"], from: "2026-01-06", to: "2026-02-28" });
    expect(card.rows.map((r) => r.id)).toEqual(["e", "c"]);

    const search = queryLedger(db, { ...DEFAULT_QUERY, q: "blue" });
    expect(search.rows.map((r) => [r.id, r.description, r.institution])).toEqual([["b", "Blue Bottle", "Chase"]]);

    // LIKE wildcards in the search are literal.
    expect(queryLedger(db, { ...DEFAULT_QUERY, q: "100%" }).rows.map((r) => r.id)).toEqual(["e"]);
    expect(queryLedger(db, { ...DEFAULT_QUERY, categories: ["UNCATEGORIZED"] }).rows.map((r) => r.id)).toEqual(["e"]);

    const paged = queryLedger(db, { ...DEFAULT_QUERY, pageSize: 2, page: 3 });
    expect(paged.rows.map((r) => r.id)).toEqual(["a"]);
    expect(paged.total).toBe(5);
  });

  it("exposes agent-friendly views", () => {
    const ledger = db.all<{ kind: string; total: number }>(sql`select kind, sum(amount) as total from v_ledger group by kind order by kind`);
    expect(ledger).toEqual([
      { kind: "income", total: 3010 }, // the uncategorized inflow counts as income
      { kind: "spend", total: -105 },
      { kind: "transfer", total: -105 },
    ]);
    const nw = db.all<{ day: string; net_worth: number }>(sql`select day, net_worth from v_net_worth_daily`);
    expect(nw).toEqual([{ day: "2026-01-15", net_worth: 800 }]);
    const flow = db.all<{ month: string; kind: string; outflow: number }>(
      sql`select month, kind, outflow from v_monthly_cashflow where kind = 'spend'`,
    );
    expect(flow).toEqual([{ month: "2026-01", kind: "spend", outflow: 105 }]);
    const accts = db.all<{ account_id: string; net_contribution: number }>(sql`select account_id, net_contribution from v_accounts order by account_id`);
    expect(accts).toEqual([
      { account_id: "card", net_contribution: -200 },
      { account_id: "chk", net_contribution: 1000 },
    ]);
  });
});
