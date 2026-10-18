# mycelium

A personal, local-first, **read-only** view of your money. It does two things:

- **Net worth.** All your accounts summed, assets minus liabilities, recorded once a day.
- **Universal ledger.** Every transaction from every linked account in one sortable, filterable table.

Mycelium pulls data through [Plaid](https://plaid.com) using read-only products only, and caches it
in one SQLite file on your machine. Agents like Claude Code can query that file directly (see
[AGENTS.md](./AGENTS.md)). Mycelium is a sibling of streak and research-log, with the same stack,
look and palettes.

## Quickstart

```bash
npm install
npm run keygen          # creates .env.local with an encryption key for Plaid tokens
# add PLAID_CLIENT_ID and PLAID_SECRET (Sandbox) to .env.local
npm run dev             # http://127.0.0.1:3002
```

Open **Accounts**, then pick **Bank or card** (checking, savings, credit cards) or **Investments**
(401(k)s, IRAs, brokerages). This starts Plaid Link.

- **In Sandbox,** choose any bank and sign in with `user_good` / `pass_good`.
- **From the CLI,** run `npm run sandbox:link`. It links Plaid's test bank without the UI.

### Without Plaid at all

```bash
npm run demo            # seeds data/demo.db with six months of fake data and serves it
```

### Going live (real accounts)

1. In the [Plaid dashboard](https://dashboard.plaid.com), request **Production** access. Personal use
   fits the free tier, which covers a handful of logins; beyond that Plaid bills per login per month.
   Check plaid.com/pricing for current terms.
2. Some large banks connect through OAuth. Complete the OAuth institution registration in the dashboard. On desktop, Link
   handles the OAuth step in a pop-up, so no redirect URI is needed.
3. Set `PLAID_ENV=production`, put your Production secret in `PLAID_SECRET`, and restart.

Sandbox and Production logins don't mix. Disconnect the Sandbox ones, or start a fresh
`DATABASE_PATH`.

## Daily recording

```bash
npm run sync               # pull everything, record today's balances
npm run launchd:install    # do that every day at 07:00 (MYCELIUM_SYNC_HOUR to change)
npm run launchd:uninstall
```

- The LaunchAgent logs to `data/sync.log`. If the Mac was asleep at 07:00, launchd runs the job on
  wake.
- The app also catches up on first page load if today hasn't been recorded yet.
- Days with no sync are drawn by carrying the last balance forward. No fake rows are written.
- Plaid can't reach localhost with webhooks, so syncing is pull-only.
- Each sync uses `/accounts/get`, which returns cached balances included with Transactions. It does
  not call the per-request real-time balance endpoint.

## Architecture

| Piece | What it is |
| --- | --- |
| App | Next.js 16, App Router, TypeScript, Tailwind + shadcn/ui, Recharts |
| API | Route handlers under `src/app/api/*`, all `runtime = "nodejs"` |
| Storage | SQLite via better-sqlite3 + Drizzle ORM, WAL mode, plus SQL views for agents |
| Plaid | `src/lib/plaid.ts` (client), `src/lib/link.ts` (token exchange), `src/lib/sync.ts` (pull) |
| Rules | Pure, tested functions: `classify.ts` (sign and kind), `net-worth.ts` (series and carry-forward) |

### Read-only by construction

- Link only requests `transactions` and `investments`. No `auth`, `transfer` or payment products are
  ever requested, so no stored credential can move money.
- Access tokens are encrypted at rest (AES-256-GCM, key in `.env.local`). If you lose the key you
  have to re-link, but your data stays readable.
- `npm run sql` opens the DB read-only and rejects anything that isn't a reader.

### Ledger semantics

- `amount` is **positive for money in**.
- `kind` is one of `income`, `spend`, `refund` or `transfer`. Transfers between your own accounts,
  credit card payments included, are kept apart so totals never double count. The rules are in
  `src/lib/classify.ts`.
- Filters live in the URL. The download icon exports the filtered set as CSV.

## Data

- **Settings → JSON** exports everything except tokens.
- **Settings → Ledger CSV** exports every transaction.
- `npm run db:backup` takes an online snapshot to `./backups/` and keeps the newest 10.
- Disconnecting a login revokes it at Plaid and deletes its local data.

## Security

Same setup as streak:

- The dev server binds to `127.0.0.1`.
- `src/proxy.ts` rejects mutating `/api/**` requests from other origins.
- JSON endpoints require `Content-Type: application/json`.
- Secrets live in `.env.local`. Both it and `data/` are gitignored.

## Tests

```bash
npm test     # classification, net-worth math, crypto, sync against a fake Plaid, ledger queries, SQL guard
npm run lint
```
