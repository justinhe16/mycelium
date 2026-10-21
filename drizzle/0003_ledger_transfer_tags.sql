-- v_ledger gains transfer_tag (card_payment | invest | internal) and unmatched (a card payment
-- with no receipt on a linked card or loan). SQLite views can't be altered, so recreate it.
DROP VIEW IF EXISTS `v_ledger`;
--> statement-breakpoint
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
  t.transfer_tag,
  t.unmatched,
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
