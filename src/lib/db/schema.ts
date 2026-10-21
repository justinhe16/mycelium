import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { KINDS, TRANSFER_TAGS } from "../classify";

/*
 * Money is stored as REAL dollars (what Plaid returns) so ad-hoc SQL from agents
 * reads naturally. Transaction amounts are normalized: positive = money in.
 * Timestamps are ISO-8601 strings; calendar days are YYYY-MM-DD (local time).
 */

/** One Plaid Item = one login at one institution (may hold several accounts). */
export const plaidItems = sqliteTable("plaid_items", {
  id: text("id").primaryKey(), // Plaid item_id
  institutionId: text("institution_id"),
  institutionName: text("institution_name").notNull().default("Unknown institution"),
  /** AES-256-GCM ciphertext (see src/lib/crypto.ts). Never sent to the client. */
  accessTokenEnc: text("access_token_enc").notNull(),
  /** JSON array of Plaid products initialized on the Item. */
  products: text("products").notNull().default("[]"),
  txCursor: text("tx_cursor"),
  status: text("status", { enum: ["ok", "login_required", "error"] }).notNull().default("ok"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  lastSyncedAt: text("last_synced_at"),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(), // Plaid account_id
    itemId: text("item_id")
      .notNull()
      .references(() => plaidItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    officialName: text("official_name"),
    mask: text("mask"),
    type: text("type").notNull(), // depository | credit | loan | investment | brokerage | other
    subtype: text("subtype"),
    currentBalance: real("current_balance"),
    availableBalance: real("available_balance"),
    creditLimit: real("credit_limit"),
    isoCurrency: text("iso_currency"),
    /** Credit and loan balances are amounts owed and subtract from net worth. */
    isLiability: integer("is_liability", { mode: "boolean" }).notNull().default(false),
    /** Hidden accounts are left out of net worth (their history is kept). */
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("accounts_item_idx").on(t.itemId)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Plaid transaction_id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    authorizedDate: text("authorized_date"),
    name: text("name").notNull(),
    merchantName: text("merchant_name"),
    /** Positive = money in, negative = money out (Plaid's sign, flipped). */
    amount: real("amount").notNull(),
    isoCurrency: text("iso_currency"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    categoryPrimary: text("category_primary"),
    categoryDetailed: text("category_detailed"),
    paymentChannel: text("payment_channel"),
    kind: text("kind", { enum: KINDS }).notNull(),
    /** For kind = transfer: card_payment | invest | internal (see src/lib/classify.ts). */
    transferTag: text("transfer_tag", { enum: TRANSFER_TAGS }),
    /** A card payment out of a bank account with no matching receipt on a linked card or loan. */
    unmatched: integer("unmatched", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("transactions_date_idx").on(t.date),
    index("transactions_account_idx").on(t.accountId),
    index("transactions_kind_idx").on(t.kind),
  ],
);

export const holdings = sqliteTable(
  "holdings",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id").notNull(),
    ticker: text("ticker"),
    name: text("name"),
    securityType: text("security_type"),
    quantity: real("quantity").notNull(),
    price: real("price"),
    value: real("value").notNull(),
    costBasis: real("cost_basis"),
    isoCurrency: text("iso_currency"),
    asOf: text("as_of").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.securityId] })],
);

/** One balance per account per local calendar day; a later sync the same day overwrites it. */
export const dailySnapshots = sqliteTable(
  "daily_snapshots",
  {
    day: text("day").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    balance: real("balance").notNull(),
    isLiability: integer("is_liability", { mode: "boolean" }).notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.accountId] }), index("daily_snapshots_account_idx").on(t.accountId)],
);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  trigger: text("trigger", { enum: ["manual", "launchd", "boot", "link", "cli"] }).notNull(),
  status: text("status", { enum: ["running", "ok", "partial", "error"] }).notNull().default("running"),
  /** JSON: { added, modified, removed, accounts, holdings, items: [{ id, status, error? }] } */
  stats: text("stats").notNull().default(sql`'{}'`),
  error: text("error"),
});
