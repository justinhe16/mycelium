-- Read-only views for humans and agents. See AGENTS.md for semantics.
-- Every transaction from every account, with its source spelled out.
CREATE VIEW `v_ledger` AS
SELECT
  t.id AS transaction_id,
  t.date,
  t.authorized_date,
  COALESCE(t.merchant_name, t.name) AS description,
  t.name AS raw_name,
  t.merchant_name,
  t.amount,
  CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END AS inflow,
  CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END AS outflow,
  t.iso_currency AS currency,
  t.kind,
  t.category_primary,
  t.category_detailed,
  t.payment_channel,
  t.pending,
  a.id AS account_id,
  a.name AS account_name,
  a.mask AS account_mask,
  a.type AS account_type,
  a.subtype AS account_subtype,
  i.id AS item_id,
  i.institution_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN plaid_items i ON i.id = a.item_id;
--> statement-breakpoint
-- Current balances, one row per account.
CREATE VIEW `v_accounts` AS
SELECT
  a.id AS account_id,
  i.institution_name,
  a.name,
  a.official_name,
  a.mask,
  a.type,
  a.subtype,
  a.current_balance,
  a.available_balance,
  a.credit_limit,
  a.iso_currency AS currency,
  a.is_liability,
  a.hidden,
  CASE WHEN a.is_liability THEN -COALESCE(a.current_balance, 0) ELSE COALESCE(a.current_balance, 0) END AS net_contribution,
  a.updated_at
FROM accounts a
JOIN plaid_items i ON i.id = a.item_id;
--> statement-breakpoint
-- Net worth per recorded day (hidden accounts excluded). Days with no sync have no row;
-- the app carries the previous value forward when charting.
CREATE VIEW `v_net_worth_daily` AS
SELECT
  s.day,
  SUM(CASE WHEN s.is_liability THEN 0 ELSE s.balance END) AS assets,
  SUM(CASE WHEN s.is_liability THEN s.balance ELSE 0 END) AS liabilities,
  SUM(CASE WHEN s.is_liability THEN -s.balance ELSE s.balance END) AS net_worth,
  COUNT(*) AS accounts
FROM daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE a.hidden = 0
GROUP BY s.day;
--> statement-breakpoint
-- Posted cash flow per month and kind. Transfers are listed but are not income or spend.
CREATE VIEW `v_monthly_cashflow` AS
SELECT
  substr(t.date, 1, 7) AS month,
  t.kind,
  SUM(t.amount) AS net,
  SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS inflow,
  SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS outflow,
  COUNT(*) AS transactions
FROM transactions t
WHERE t.pending = 0
GROUP BY month, t.kind;
