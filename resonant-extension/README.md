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
| `spending_summary {period}` | tool | L0 | Income, spend (net of refunds), refunds, net, top categories and merchants. Posted only, transfers excluded. `period`: `this_month`, `last_month`, `last_7_days`, `last_30_days`, `ytd`, `YYYY-MM`, or `YYYY-MM-DD..YYYY-MM-DD`. |
| `daily` | job, 07:20 | L0 | After mycelium's 07:00 launchd sync, reports the pulse item `mycelium/daily` at `normal` urgency: `Net worth $23.5k (+$500) · 2 new transactions, $30 spent`. "New" means transactions mycelium added in the last 24 hours. A sync older than 26 hours or a login that needs relinking leads the line (`⚠ no sync since 2026-10-19`). With none of that, no new transactions and an unchanged net worth, it reports **quiet**, so the pulse and the briefing leave it out. `catchup: 2h`. |
| health | every 30 min | | The database opens and `accounts` reads. |

The item's state is coarse (the snapshot day, the new-transaction count, net worth in thousands,
the stale and relink flags), so each day's summary is news once and a rerun is not. It never texts
on its own: `report: {max_urgency: normal}` puts it in the next hourly pulse.

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
2. `database_path` in `~/.resonant/ext-data/mycelium/config.json`:
   `{"database_path": "/Users/justinhe/code/mycelium/data/mycelium.db"}`.
3. `/Users/$USER/code/mycelium/data/mycelium.db`.

## By hand and tests

```sh
MYCELIUM_DB=data/demo.db python3 resonant-extension/cli.py spending_summary --period last_month
npm run test:resonant      # python3 -m unittest discover -s resonant-extension/tests
```

The tests build their database from `drizzle/*.sql`, so they run against mycelium's real schema and
views. `emit.py` is a verbatim copy of `resonant_sdk/emit.py`; a test checks it still matches when a
Resonant checkout is at `~/resonant`.
