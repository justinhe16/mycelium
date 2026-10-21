# mycelium extension for Resonant

Lets you ask Resonant about your money by text, answered from mycelium's local SQLite mirror of
Plaid, and puts a daily summary in the pulse. Stdlib Python only. Every command opens the database
**read-only** (`mode=ro` and `PRAGMA query_only`) and never writes: Plaid is the source of truth and
mycelium's own sync does every write.

## Install

On the Mini, in its terminal, from a clean checkout of mycelium's `main` (`path:` reads the tracked
files and refuses uncommitted changes):

```sh
resonant ext add path:/Users/justinhe/code/mycelium/resonant-extension
```

Check it first with `resonant ext validate /Users/justinhe/code/mycelium/resonant-extension`. After
pulling changes, `resonant ext update mycelium`.

## What it adds

| Name | Kind | Level | What it does |
|---|---|---|---|
| `net_worth` | tool | L0 | Net worth from the latest daily snapshot (assets, liabilities), with its change over 1 day, 30 days and the year (days without a sync carry forward). Before the first snapshot it sums current balances. |
| `account_balances` | tool | L0 | Every account with its balance (available when it differs), liabilities marked `owed`, hidden accounts marked and left out of the totals. |
| `recent_transactions {days}` | tool | L0 | The last `days` (1-90) of transactions, newest first, at most 30 shown, plus the total count. Pending ones are marked. |
| `spending_summary {period}` | tool | L0 | Income, spend (net of refunds), refunds, net, top categories and merchants. Posted only, transfers excluded. `period`: `this_month`, `last_month`, `last_7_days`, `last_30_days`, `last_12_months` (the 365 days ending today), `ytd`, `all`, `YYYY-MM`, or `YYYY-MM-DD..YYYY-MM-DD`. The new tools take the same periods. |
| `search_transactions {query, period}` | tool | L0 | "What's the total of my transactions with Whole Foods?" Every transaction whose merchant name, raw bank name or category (primary or detailed) contains `query`, case-insensitively (`food and drink` also finds `FOOD_AND_DRINK`). Returns the count, money in, money out, net, and first and last date, then the newest 25 rows (pending ones marked). Totals are posted only and cover **every** match. When rows are cut, `truncated` is true and the note says how many were shown. Transfers are excluded, like `spending_summary`: `transfers_included: false`, and any matching transfers are counted in `transfers_excluded`. Matching pending rows are summed in `pending`. `query` is 1-64 characters. |
| `merchant_totals {period, limit}` | tool | L0 | Spend (net of refunds), income and transaction count per merchant, biggest spend first, `limit` merchants (1-100; the CLI defaults to 25). `spend`, `income` and `merchant_count` cover every merchant, not only those shown. Posted only, transfers excluded. |
| `daily` | job, 07:20 | L0 | After mycelium's 07:00 launchd sync, reports the pulse item `mycelium/daily` at `normal` urgency: `Net worth $23.5k (+$500) · 2 new transactions, $30 spent`. "New" means posted transactions mycelium added since the job's last run (see below). A sync older than 26 hours or a login that needs relinking leads the line (`⚠ no sync since 2026-10-19`). A newly linked login is mentioned (`1 new login linked`), but its history isn't counted as new spending. Net worth counts as moved when it is $100 or 0.5% (whichever is more) away from the last figure reported. With none of that, it reports **quiet**, so the pulse and the briefing leave it out. `catchup: 2h`. |
| health | every 30 min | | The database opens and `accounts` reads. |

The job keeps a mark in `$RESONANT_EXT_DATA/daily.json`: the newest `created_at` it has counted
and the net worth it last reported. The next run counts from that mark, so a late sync or a late
job never drops or repeats a transaction. Pending rows are left out because Plaid re-adds a posted
charge under a new id; counting both would count it twice. Without a mark (the first run, which
Resonant keeps silent anyway), it counts the last 24 hours.

The item's state is coarse (the snapshot day, the new-transaction and new-login counts, net worth
in thousands, the stale and relink flags), so each day's summary is news once and a rerun is not.
A stale sync is told once, not every day, until something else changes. It never texts on its own:
`report: {max_urgency: normal}` puts it in the next hourly pulse.

The job has no `tz`, so it runs on the daemon's timezone. That matches the launchd sync while both
run on the same Mac. If they ever run on different machines, set `tz` so 07:20 still falls after
the sync.

## Trust

- **Owner-only.** The manifest names no `approvers` and needs no secrets. Don't grant anyone
  `request` or `approve` for `mycelium` in `principals.yaml`, so only the owner can use it.
- **Results taint.** Account, institution and merchant names come from banks. Resonant treats every
  extension tool's result as untrusted, so a task that called one of these tools is tainted and its
  later writes ask first. Results also say `"untrusted": true`.
- Nothing here can move money: there are no write tools, and mycelium only requests read products
  from Plaid.

## Config

Where the database is, first match wins:

1. `$MYCELIUM_DB`, for running by hand (Resonant builds the environment from scratch).
2. `database_path` in `~/.resonant/ext-data/mycelium/config.json`, as an absolute path (under
   Resonant, `HOME` is the data dir, so `~` doesn't mean your home):
   `{"database_path": "/Users/justinhe/code/mycelium/data/mycelium.db"}`.
3. `/Users/$USER/code/mycelium/data/mycelium.db`.

## By hand and tests

```sh
MYCELIUM_DB=data/demo.db python3 resonant-extension/cli.py spending_summary --period last_month
MYCELIUM_DB=data/demo.db python3 resonant-extension/cli.py search_transactions --query="whole foods" --period=ytd
MYCELIUM_DB=data/demo.db python3 resonant-extension/cli.py merchant_totals --period=last_month --limit=25
npm run test:resonant      # python3 -m unittest discover -s resonant-extension/tests
```

The tests build their database from `drizzle/*.sql`, so they run against mycelium's real schema and
views. `emit.py` is a verbatim copy of `resonant_sdk/emit.py`; a test checks it still matches when a
Resonant checkout is at `~/resonant`. Another test runs Resonant's `load_manifest`, `name_errors`
and `dir_errors` with `~/resonant/.venv/bin/python` (or `$RESONANT_PYTHON`), and skips when
neither exists.
