import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "./db/create";
import { accounts, plaidItems, transactions } from "./db/schema";
import type { LedgerQuery } from "./ledger-query";
import type { LedgerPage } from "./types";

/** Escape LIKE wildcards so a search for "100%" matches literally. */
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function queryLedger(db: Db, q: LedgerQuery): LedgerPage {
  const description = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;
  const where: SQL[] = [];
  if (q.accounts.length) where.push(inArray(transactions.accountId, q.accounts));
  if (q.kinds.length) where.push(inArray(transactions.kind, q.kinds));
  if (q.categories.length) where.push(inArray(sql`coalesce(${transactions.categoryPrimary}, 'UNCATEGORIZED')`, q.categories));
  if (q.from) where.push(gte(transactions.date, q.from));
  if (q.to) where.push(lte(transactions.date, q.to));
  if (q.pending === "exclude") where.push(eq(transactions.pending, false));
  if (q.pending === "only") where.push(eq(transactions.pending, true));
  if (q.q) {
    const pat = likePattern(q.q);
    where.push(
      or(
        sql`${transactions.name} LIKE ${pat} ESCAPE '\\'`,
        sql`${transactions.merchantName} LIKE ${pat} ESCAPE '\\'`,
        sql`${transactions.categoryDetailed} LIKE ${pat} ESCAPE '\\'`,
      )!,
    );
  }
  const filter = where.length ? and(...where) : undefined;

  const sortCol = {
    date: transactions.date,
    amount: transactions.amount,
    description,
    account: accounts.name,
    category: transactions.categoryPrimary,
    kind: transactions.kind,
  }[q.sort];
  const order = q.dir === "asc" ? asc : desc;

  const rows = db
    .select({
      id: transactions.id,
      date: transactions.date,
      description,
      rawName: transactions.name,
      amount: transactions.amount,
      currency: transactions.isoCurrency,
      kind: transactions.kind,
      categoryPrimary: transactions.categoryPrimary,
      categoryDetailed: transactions.categoryDetailed,
      pending: transactions.pending,
      paymentChannel: transactions.paymentChannel,
      accountId: accounts.id,
      accountName: accounts.name,
      accountMask: accounts.mask,
      institution: plaidItems.institutionName,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.itemId))
    .where(filter)
    // Stable tie-break so paging never repeats or skips rows.
    .orderBy(order(sortCol), desc(transactions.date), asc(transactions.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .all();

  const agg = db
    .select({
      total: sql<number>`count(*)`,
      inflow: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      outflow: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(filter)
    .get()!;

  return {
    rows,
    total: agg.total,
    inflow: agg.inflow,
    outflow: agg.outflow,
    page: q.page,
    pageSize: q.pageSize,
  };
}

