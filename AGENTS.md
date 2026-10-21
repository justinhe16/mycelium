<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Querying Mycelium's data

Mycelium keeps everything in one SQLite file: `data/mycelium.db` (or `$DATABASE_PATH`).
It is a **read-only mirror** of the user's bank, card and investment accounts, pulled from Plaid.
When the user asks about their money (spending, income, balances, net worth, trends), answer by
querying this database.

## How to query

```bash
npm run sql -- "SELECT ..."            # table output
npm run sql -- --json "SELECT ..."     # JSON rows
npm run sql -- --schema                # every table and view, with CREATE statements
sqlite3 -readonly data/mycelium.db     # also fine
```

`npm run sql` opens the file read-only and rejects anything that isn't a SELECT/WITH. **Never write
to this database.** Plaid is the source of truth, and the app re-syncs from it. To change what's
stored, change the sync code instead.

## Start with the views

| View | One row per | Key columns |
| --- | --- | --- |
| `v_ledger` | transaction, from every account | `date`, `description`, `amount`, `inflow`, `outflow`, `kind`, `transfer_tag`, `unmatched`, `category_primary`, `category_detailed`, `pending`, `account_name`, `account_mask`, `account_type`, `institution_name` |
| `v_accounts` | account | `institution_name`, `name`, `type`, `subtype`, `current_balance`, `is_liability`, `hidden`, `net_contribution` |
| `v_net_worth_daily` | recorded day | `day`, `assets`, `liabilities`, `net_worth` (hidden accounts excluded) |
| `v_monthly_cashflow` | month × kind (posted only) | `month` (YYYY-MM), `kind`, `net`, `inflow`, `outflow`, `transactions` |

Underlying tables: `plaid_items`, `accounts`, `transactions`, `holdings` (investment positions:
ticker, quantity, value, cost_basis), `daily_snapshots` (account × day balances), and `sync_runs`.

## Conventions (read before doing math)

- **Sign:** `amount` is **positive for money in** and negative for money out. This is the opposite
  of Plaid's raw convention.
- **Money** is REAL dollars, and `currency` is usually USD. Round when presenting.
- **Dates** are `YYYY-MM-DD` text, so string comparison works: `date >= '2026-01-01'`.
- **`kind`** (set by `src/lib/classify.ts`, re-applied to every row on each sync):
  - `income`: paychecks, interest, dividends.
  - `spend`: money out to the world, including rent, non-card loan payments, and Venmo / Zelle /
    app payments out (`TRANSFER_OUT_TRANSFER_OUT_FROM_APPS`).
  - `refund`: money back from a merchant, and Venmo / Zelle / app money in
    (`TRANSFER_IN_TRANSFER_IN_FROM_APPS`, e.g. a friend paying you back). Refunds lower spend.
  - `transfer`: moving money between the user's own accounts. `transfer_tag` says which:
    - `card_payment`: paying a credit card or loan, on both sides: the checking side
      (`LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`) and the card side (money in on a credit or loan
      account under `LOAN_DISBURSEMENTS`, `LOAN_PAYMENTS` or `TRANSFER_IN`; Chase sends
      `LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT`).
    - `invest`: to or from an investment or retirement account (`*_INVESTMENT_AND_RETIREMENT_FUNDS`,
      or any row on an investment account). Net invested = `-sum(amount)` over these.
    - `internal`: any other `TRANSFER_IN` / `TRANSFER_OUT`.

  **Exclude `transfer` from income and spend totals.** Otherwise a card payment counts twice:
  once as the purchases on the card, and again as the payment from checking.
- **`unmatched = 1`** marks a card payment out of a bank account with no equal receipt on a linked
  card or loan within 5 days: the card isn't linked (or its side hasn't posted yet). It is still a
  transfer. Pending payments are never flagged.
- **Pending** rows (`pending = 1`) may still change or disappear. Exclude them for settled totals.
- **Categories** are Plaid's personal-finance categories. `category_primary` is coarse, like
  `FOOD_AND_DRINK`; `category_detailed` is finer, like `FOOD_AND_DRINK_COFFEE`. NULL means
  uncategorized.
- **Liabilities:** for credit and loan accounts, `current_balance` is the amount owed, as a positive
  number. Net worth = assets − liabilities.
- **History:** `v_net_worth_daily` has a row only for days a sync ran. Carry the last value forward
  across gaps.
- `hidden` accounts are excluded from net worth by the user's choice. Their transactions are still
  in the ledger.

## Example queries

```sql
-- Spend by category last month
SELECT category_primary, round(-sum(amount), 2) AS spent
FROM v_ledger
WHERE kind = 'spend' AND pending = 0
  AND date >= date('now', 'start of month', '-1 month') AND date < date('now', 'start of month')
GROUP BY 1 ORDER BY spent DESC;

-- Invested this year (net into investment accounts)
SELECT round(-sum(amount), 2) AS invested FROM v_ledger
WHERE transfer_tag = 'invest' AND pending = 0 AND date >= strftime('%Y-01-01','now');

-- Savings rate by month
SELECT month,
       sum(CASE WHEN kind = 'income' THEN net END) AS income,
       -sum(CASE WHEN kind IN ('spend','refund') THEN net END) AS spend
FROM v_monthly_cashflow GROUP BY month ORDER BY month;

-- Net worth change since Jan 1
SELECT (SELECT net_worth FROM v_net_worth_daily ORDER BY day DESC LIMIT 1)
     - (SELECT net_worth FROM v_net_worth_daily WHERE day >= strftime('%Y-01-01','now') ORDER BY day LIMIT 1) AS ytd_change;

-- Top merchants, last 90 days
SELECT description, count(*) n, round(-sum(amount), 2) total
FROM v_ledger WHERE kind = 'spend' AND date >= date('now','-90 days')
GROUP BY 1 ORDER BY total DESC LIMIT 15;

-- Recurring charges (same merchant, 3+ distinct months)
SELECT description, count(DISTINCT substr(date,1,7)) months, round(avg(-amount),2) avg_amount
FROM v_ledger WHERE kind = 'spend'
GROUP BY 1 HAVING months >= 3 ORDER BY months DESC, avg_amount DESC;
```

To try queries without real data, run `npm run demo:seed`, then prefix commands with
`DATABASE_PATH=data/demo.db`.

# Working on the code

- The stack mirrors `../streak`: Next.js 16 App Router, Tailwind v4 + shadcn/ui, better-sqlite3 +
  Drizzle. Run `npm test`, `npm run lint` and `npm run build` before calling something done.
- Schema changes:
  1. Edit `src/lib/db/schema.ts`.
  2. Run `npm run db:generate`.
  3. For a view change, write a custom migration with `npx drizzle-kit generate --custom`.
- `src/lib/sync.ts` takes Plaid as an injected dependency. Test it against a fake (see
  `src/lib/__tests__/sync.test.ts`), never against the real API.
- Only request read products from Plaid (`transactions`, `investments`, and optionally
  `liabilities`). Never `auth`, `transfer`, `payment_initiation` or anything else that can move
  money.
