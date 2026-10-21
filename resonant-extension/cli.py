#!/usr/bin/env python3
"""Mycelium for Resonant: read-only questions about your money, and a daily summary.

Every command opens mycelium's SQLite file read-only (``mode=ro`` plus ``query_only``) and
prints one JSON object on stdout. Nothing here writes to the database: Plaid is the source
of truth and mycelium's own sync owns every write. See ../AGENTS.md for the data's
conventions (amount > 0 is money in; transfers are not income or spend; Venmo / Zelle
payments out are spend and paybacks are refunds; transfer_tag says card_payment, invest or
internal; unmatched = 1 marks a card payment with no receipt on a linked card).

Where the database is, first match wins:
1. ``$MYCELIUM_DB`` (for running by hand; Resonant builds the environment from scratch).
2. ``database_path`` in ``$RESONANT_EXT_DATA/config.json``.
3. ``/Users/$USER/code/mycelium/data/mycelium.db``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

# emit.py is the SDK's stdlib-only helper, copied next to this script. Under `python -I` the
# script's directory is not on sys.path, so add it.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from emit import report  # noqa: E402

REPORT_KEY = "mycelium/daily"
STALE_AFTER = timedelta(hours=26)  # the sync runs daily at 07:00; allow for a late one
FIRST_WINDOW = timedelta(hours=24)  # "new" on the very first run, before there is a mark
MOVE_MIN = 100.0  # net worth moves smaller than this (or MOVE_PCT of it) aren't news
MOVE_PCT = 0.005
MARK_FILE = "daily.json"  # in $RESONANT_EXT_DATA: what the daily job last told
MAX_DAYS = 90
MAX_ROWS = 30  # the model sees at most 4 KB of a result, so keep lists short
SEARCH_ROWS = 25  # search rows carry totals ahead of them; keep the whole result under 4 KB
MAX_QUERY = 64
MERCHANT_LIMIT, MAX_MERCHANT_LIMIT = 25, 100
TOP_N = 8
ALL_START = date(1900, 1, 1)  # period "all": every row mycelium has


class UserError(Exception):
    """A problem worth telling the caller about (missing database, bad argument)."""


# ---------------------------------------------------------------- database


def db_path() -> Path:
    env = os.environ.get("MYCELIUM_DB")
    if env:
        return Path(env)
    data = os.environ.get("RESONANT_EXT_DATA")
    if data:
        config = Path(data) / "config.json"
        if config.is_file():
            try:
                value = json.loads(config.read_text()).get("database_path")
            except (ValueError, AttributeError) as e:
                raise UserError(f"{config} is not a JSON object: {e}") from e
            if value:
                path = Path(value)
                if not path.is_absolute():
                    # HOME is the extension's data dir under Resonant, so `~` would mislead.
                    raise UserError(f"database_path in {config} must be an absolute path")
                return path
    user = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
    return Path("/Users") / user / "code/mycelium/data/mycelium.db"


def connect(path: Optional[Path] = None) -> sqlite3.Connection:
    path = path or db_path()
    if not path.is_file():
        raise UserError(f"no mycelium database at {path} (set database_path in config.json)")
    conn = sqlite3.connect(f"file:{quote(str(path.resolve()))}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = 1")
    return conn


def one(conn: sqlite3.Connection, sql: str, params: Tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
    return conn.execute(sql, params).fetchone()


def money(x: Optional[float]) -> Optional[float]:
    # + 0.0 turns -0.0 (refunds that cancel the spend exactly) into 0.0
    return None if x is None else round(x, 2) + 0.0


def iso_utc(dt: datetime) -> str:
    """The format mycelium's sync writes (JS ``toISOString``), so strings compare in order."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def last_sync(conn: sqlite3.Connection) -> Optional[str]:
    row = one(conn, "SELECT max(finished_at) AS at FROM sync_runs WHERE status IN ('ok', 'partial')")
    return row["at"] if row else None


# ---------------------------------------------------------------- tools


def net_worth_on(conn: sqlite3.Connection, day: str) -> Optional[sqlite3.Row]:
    """The last recorded day on or before ``day`` (days without a sync carry forward)."""
    return one(
        conn,
        "SELECT day, assets, liabilities, net_worth FROM v_net_worth_daily"
        " WHERE day <= ? ORDER BY day DESC LIMIT 1",
        (day,),
    )


def net_worth(conn: sqlite3.Connection, today: date) -> Dict[str, Any]:
    latest = net_worth_on(conn, "9999-12-31")
    if latest is None:
        # No snapshot yet: sum the live balances of visible accounts.
        row = one(
            conn,
            "SELECT sum(CASE WHEN is_liability THEN 0 ELSE coalesce(current_balance, 0) END) AS a,"
            " sum(CASE WHEN is_liability THEN coalesce(current_balance, 0) ELSE 0 END) AS l"
            " FROM v_accounts WHERE hidden = 0",
        )
        assets, liabilities = (row["a"] or 0.0), (row["l"] or 0.0)
        return {
            "as_of": None,
            "net_worth": money(assets - liabilities),
            "assets": money(assets),
            "liabilities": money(liabilities),
            "changes": {},
            "last_sync": last_sync(conn),
            "note": "no daily snapshot yet; from current balances",
        }
    changes: Dict[str, Optional[float]] = {}
    latest_day = date.fromisoformat(latest["day"])
    for label, since in (
        ("1d", latest_day - timedelta(days=1)),
        ("30d", latest_day - timedelta(days=30)),
        ("ytd", date(today.year, 1, 1) - timedelta(days=1)),
    ):
        base = net_worth_on(conn, since.isoformat())
        changes[label] = money(latest["net_worth"] - base["net_worth"]) if base else None
    return {
        "as_of": latest["day"],
        "net_worth": money(latest["net_worth"]),
        "assets": money(latest["assets"]),
        "liabilities": money(latest["liabilities"]),
        "changes": changes,
        "last_sync": last_sync(conn),
    }


def account_balances(conn: sqlite3.Connection) -> Dict[str, Any]:
    rows = conn.execute(
        "SELECT institution_name, name, mask, type, subtype, current_balance, available_balance,"
        " is_liability, hidden FROM v_accounts"
        " ORDER BY hidden, is_liability, institution_name, name"
    ).fetchall()
    accounts = []
    for r in rows:
        a: Dict[str, Any] = {
            "institution": r["institution_name"],
            "name": r["name"] + (f" ··{r['mask']}" if r["mask"] else ""),
            "type": r["subtype"] or r["type"],
            "balance": money(r["current_balance"]),
        }
        if r["available_balance"] is not None and r["available_balance"] != r["current_balance"]:
            a["available"] = money(r["available_balance"])
        if r["is_liability"]:
            a["owed"] = True
        if r["hidden"]:
            a["hidden"] = True
        accounts.append(a)
    visible = [r for r in rows if not r["hidden"]]
    assets = sum(r["current_balance"] or 0 for r in visible if not r["is_liability"])
    owed = sum(r["current_balance"] or 0 for r in visible if r["is_liability"])
    return {
        "accounts": accounts,
        "count": len(accounts),
        "assets": money(assets),
        "liabilities": money(owed),
        "last_sync": last_sync(conn),
        "note": "liability balances are amounts owed; hidden accounts are left out of the totals",
    }


def recent_transactions(conn: sqlite3.Connection, days: int, today: date) -> Dict[str, Any]:
    if not 1 <= days <= MAX_DAYS:
        raise UserError(f"days must be 1..{MAX_DAYS}")
    since = (today - timedelta(days=days - 1)).isoformat()
    total = one(conn, "SELECT count(*) AS n FROM v_ledger WHERE date >= ?", (since,))["n"]
    rows = conn.execute(
        "SELECT date, description, amount, kind, category_primary, pending, account_name, account_mask"
        " FROM v_ledger WHERE date >= ? ORDER BY date DESC, pending DESC, abs(amount) DESC LIMIT ?",
        (since, MAX_ROWS),
    ).fetchall()
    txns = []
    for r in rows:
        t: Dict[str, Any] = {
            "date": r["date"],
            "description": r["description"],
            "amount": money(r["amount"]),
            "kind": r["kind"],
            "category": r["category_primary"],
            "account": r["account_name"] + (f" ··{r['account_mask']}" if r["account_mask"] else ""),
        }
        if r["pending"]:
            t["pending"] = True
        txns.append(t)
    return {
        "since": since,
        "transactions": txns,
        "shown": len(txns),
        "total": total,
        "note": "amount > 0 is money in; transfers move money between your own accounts",
    }


_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_RANGE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$")
PERIODS = (
    "this_month, last_month, last_7_days, last_30_days, last_12_months, ytd, all, YYYY-MM,"
    " or YYYY-MM-DD..YYYY-MM-DD"
)


def period_range(period: str, today: date) -> Tuple[date, date]:
    """``period`` as an inclusive [start, end] pair of days."""
    p = period.strip().lower()
    first = today.replace(day=1)
    if p == "this_month":
        return first, today
    if p == "last_month":
        end = first - timedelta(days=1)
        return end.replace(day=1), end
    if p in ("last_7_days", "last_30_days"):
        n = 7 if p == "last_7_days" else 30
        return today - timedelta(days=n - 1), today
    if p == "last_12_months":  # the 365 days ending today
        return today - timedelta(days=364), today
    if p == "ytd":
        return date(today.year, 1, 1), today
    if p == "all":
        return ALL_START, today
    m = _MONTH.match(p)
    if m:
        try:
            start = date(int(m.group(1)), int(m.group(2)), 1)
        except ValueError as e:
            raise UserError(f"bad month {period!r}") from e
        nxt = date(start.year + start.month // 12, start.month % 12 + 1, 1)
        return start, nxt - timedelta(days=1)
    m = _RANGE.match(p)
    if m:
        try:
            start, end = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
        except ValueError as e:
            raise UserError(f"bad date in {period!r}") from e
        if end < start:
            raise UserError("the range ends before it starts")
        if (end - start).days > 366 * 3:
            raise UserError("the range is longer than 3 years")
        return start, end
    raise UserError(f"period must be {PERIODS}")


def spending_summary(conn: sqlite3.Connection, period: str, today: date) -> Dict[str, Any]:
    start, end = period_range(period, today)
    span = (start.isoformat(), end.isoformat())
    posted = "pending = 0 AND date >= ? AND date <= ?"
    totals = one(
        conn,
        "SELECT sum(CASE WHEN kind = 'income' THEN amount ELSE 0 END) AS income,"
        " -sum(CASE WHEN kind IN ('spend', 'refund') THEN amount ELSE 0 END) AS spend,"
        " sum(CASE WHEN kind = 'refund' THEN amount ELSE 0 END) AS refunds,"
        " count(CASE WHEN kind IN ('spend', 'refund') THEN 1 END) AS n,"
        " -sum(CASE WHEN transfer_tag = 'invest' THEN amount ELSE 0 END) AS invested,"
        " count(CASE WHEN unmatched = 1 THEN 1 END) AS unmatched_n,"
        " -sum(CASE WHEN unmatched = 1 THEN amount ELSE 0 END) AS unmatched_total"
        f" FROM v_ledger WHERE {posted}",
        span,
    )
    by_category = [
        {"category": r["category"] or "UNCATEGORIZED", "spent": money(r["spent"])}
        for r in conn.execute(
            "SELECT category_primary AS category, -sum(amount) AS spent FROM v_ledger"
            f" WHERE kind IN ('spend', 'refund') AND {posted}"
            " GROUP BY 1 ORDER BY spent DESC LIMIT ?",
            span + (TOP_N,),
        )
    ]
    merchants = [
        {"merchant": r["description"], "spent": money(r["spent"]), "count": r["n"]}
        for r in conn.execute(
            "SELECT description, -sum(amount) AS spent, count(*) AS n FROM v_ledger"
            f" WHERE kind = 'spend' AND {posted}"
            " GROUP BY 1 ORDER BY spent DESC LIMIT ?",
            span + (TOP_N,),
        )
    ]
    pending = one(
        conn,
        "SELECT count(*) AS n, -sum(amount) AS spent FROM v_ledger"
        " WHERE pending = 1 AND kind IN ('spend', 'refund') AND date >= ? AND date <= ?",
        span,
    )
    income, spend = totals["income"] or 0.0, totals["spend"] or 0.0
    out: Dict[str, Any] = {
        "period": period,
        "start": shown_start(start),
        "end": span[1],
        "income": money(income),
        "spend": money(spend),
        "refunds": money(totals["refunds"] or 0.0),
        "net": money(income - spend),
        "spend_transactions": totals["n"],
        # Transfers stay out of income and spend; these two are reported beside them.
        "invested": money(totals["invested"] or 0.0),
        "unmatched_card_payments": {
            "count": totals["unmatched_n"],
            "total": money(totals["unmatched_total"] or 0.0),
        },
        "by_category": by_category,
        "top_merchants": merchants,
        "note": "posted only; spend is net of refunds (Venmo / Zelle paybacks count as refunds,"
        " payments out as spend); transfers (card payments, investing, moves between your"
        " accounts) excluded; invested is net money into investment accounts;"
        " unmatched_card_payments went to a card or loan that isn't linked",
    }
    if pending["n"]:
        out["pending"] = {"count": pending["n"], "spend": money(pending["spent"])}
    return out


def shown_start(start: date) -> Optional[str]:
    """The period's first day as shown; None for ``all`` (there is no real first day)."""
    return None if start == ALL_START else start.isoformat()


def fold(value: Optional[str]) -> Optional[str]:
    """Case folding for matching. SQLite's lower() only folds ASCII; this folds everything."""
    return value.casefold() if isinstance(value, str) else value


def search_transactions(conn: sqlite3.Connection, query: str, period: str, today: date) -> Dict[str, Any]:
    """Every transaction whose merchant, name or category contains ``query``, in ``period``.

    Totals are posted rows only and cover every match; at most SEARCH_ROWS rows are listed.
    Transfers are left out (as in spending_summary) and counted separately.
    """
    q = query.strip()
    if not 1 <= len(q) <= MAX_QUERY:
        raise UserError(f"query must be 1..{MAX_QUERY} characters")
    start, end = period_range(period, today)
    conn.create_function("fold", 1, fold, deterministic=True)
    needle = q.casefold()
    # "food and drink" finds FOOD_AND_DRINK: categories use underscores for spaces.
    cat_needle = "_".join(needle.split())
    match = (
        "date >= ? AND date <= ? AND ("
        " instr(fold(raw_name), ?) > 0 OR instr(fold(coalesce(merchant_name, '')), ?) > 0"
        " OR instr(fold(coalesce(category_primary, '')), ?) > 0"
        " OR instr(fold(coalesce(category_detailed, '')), ?) > 0)"
    )
    params = (start.isoformat(), end.isoformat(), needle, needle, cat_needle, cat_needle)
    totals = one(
        conn,
        "SELECT count(*) AS n, sum(inflow) AS money_in, sum(outflow) AS money_out,"
        " min(date) AS first, max(date) AS last"
        f" FROM v_ledger WHERE pending = 0 AND kind != 'transfer' AND {match}",
        params,
    )
    pending = one(
        conn,
        "SELECT count(*) AS n, sum(inflow) AS money_in, sum(outflow) AS money_out"
        f" FROM v_ledger WHERE pending = 1 AND kind != 'transfer' AND {match}",
        params,
    )
    transfers = one(
        conn,
        f"SELECT count(*) AS n, sum(amount) AS net FROM v_ledger WHERE kind = 'transfer' AND {match}",
        params,
    )
    rows = conn.execute(
        "SELECT date, description, amount, kind, pending, account_name, account_mask"
        f" FROM v_ledger WHERE kind != 'transfer' AND {match}"
        " ORDER BY date DESC, pending DESC, abs(amount) DESC, transaction_id LIMIT ?",
        params + (SEARCH_ROWS,),
    ).fetchall()
    money_in, money_out = totals["money_in"] or 0.0, totals["money_out"] or 0.0
    listed = totals["n"] + pending["n"]
    # Totals first: the model sees at most 4 KB, so they must survive a cut.
    out: Dict[str, Any] = {
        "query": q,
        "period": period,
        "start": shown_start(start),
        "end": end.isoformat(),
        "count": totals["n"],
        "money_in": money(money_in),
        "money_out": money(money_out),
        "net": money(money_in - money_out),
        "first_date": totals["first"],
        "last_date": totals["last"],
        "transfers_included": False,
    }
    if pending["n"]:
        out["pending"] = {
            "count": pending["n"],
            "money_in": money(pending["money_in"] or 0.0),
            "money_out": money(pending["money_out"] or 0.0),
        }
    if transfers["n"]:
        out["transfers_excluded"] = {"count": transfers["n"], "net": money(transfers["net"] or 0.0)}
    txns = []
    for r in rows:
        t: Dict[str, Any] = {
            "date": r["date"],
            "description": r["description"],
            "amount": money(r["amount"]),
            "kind": r["kind"],
            "account": r["account_name"] + (f" ··{r['account_mask']}" if r["account_mask"] else ""),
        }
        if r["pending"]:
            t["pending"] = True
        txns.append(t)
    out["shown"] = len(txns)
    out["truncated"] = listed > len(txns)
    note = (
        "case-insensitive match on merchant, name and category; totals are posted only;"
        " amount > 0 is money in; transfers between your own accounts excluded"
    )
    if out["truncated"]:
        note += f"; showing the newest {len(txns)} of {listed} rows, but the totals cover all {totals['n']} posted matches"
    out["note"] = note
    out["transactions"] = txns
    return out


def merchant_totals(conn: sqlite3.Connection, period: str, limit: int, today: date) -> Dict[str, Any]:
    """Spend (net of refunds) and income per merchant for ``period``, biggest spend first."""
    if not 1 <= limit <= MAX_MERCHANT_LIMIT:
        raise UserError(f"limit must be 1..{MAX_MERCHANT_LIMIT}")
    start, end = period_range(period, today)
    span = (start.isoformat(), end.isoformat())
    grouped = (
        "SELECT description AS merchant,"
        " -sum(CASE WHEN kind IN ('spend', 'refund') THEN amount ELSE 0 END) AS spent,"
        " sum(CASE WHEN kind = 'income' THEN amount ELSE 0 END) AS income,"
        " count(*) AS n FROM v_ledger"
        " WHERE pending = 0 AND kind != 'transfer' AND date >= ? AND date <= ? GROUP BY description"
    )
    totals = one(
        conn,
        f"SELECT count(*) AS merchants, sum(spent) AS spent, sum(income) AS income FROM ({grouped})",
        span,
    )
    rows = conn.execute(
        f"SELECT * FROM ({grouped}) ORDER BY spent DESC, income DESC, merchant LIMIT ?",
        span + (limit,),
    ).fetchall()
    merchants = []
    for r in rows:
        m: Dict[str, Any] = {"merchant": r["merchant"], "spent": money(r["spent"]), "count": r["n"]}
        if r["income"]:
            m["income"] = money(r["income"])
        merchants.append(m)
    pending = one(
        conn,
        "SELECT count(*) AS n FROM v_ledger WHERE pending = 1 AND kind != 'transfer'"
        " AND date >= ? AND date <= ?",
        span,
    )
    out: Dict[str, Any] = {
        "period": period,
        "start": shown_start(start),
        "end": span[1],
        "spend": money(totals["spent"] or 0.0),
        "income": money(totals["income"] or 0.0),
        "merchant_count": totals["merchants"],
        "shown": len(merchants),
        "truncated": totals["merchants"] > len(merchants),
        "transfers_included": False,
        "note": "posted only; spent is net of refunds; spend and income totals cover every merchant,"
        " not just those shown; transfers between your own accounts excluded",
    }
    if pending["n"]:
        out["pending_excluded"] = pending["n"]
    out["merchants"] = merchants
    return out


# ---------------------------------------------------------------- daily job


def short_money(x: float, signed: bool = False) -> str:
    sign = ("+" if x >= 0 else "-") if signed else ("-" if x < 0 else "")
    v = abs(x)
    if v >= 1_000_000:
        body = f"${v / 1_000_000:.2f}M"
    elif v >= 10_000:
        body = f"${v / 1000:.1f}k"
    else:
        body = f"${v:,.0f}"
    return sign + body


def daily_summary(
    conn: sqlite3.Connection, now: datetime, mark: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """What changed since the last run, as a pulse item. ``quiet`` when nothing is new.

    ``mark`` is what the previous run returned as ``mark`` (None on the first run). "New" is
    measured from it, not from the clock, so a late sync or a late job neither drops nor
    repeats transactions.
    """
    mark = mark or {}
    synced = last_sync(conn)
    stale = synced is None or synced < iso_utc(now - STALE_AFTER)
    attention = one(conn, "SELECT count(*) AS n FROM plaid_items WHERE status != 'ok'")["n"]

    seen = mark.get("seen") or iso_utc(now - FIRST_WINDOW)
    # Posted rows only: a pending charge comes back under a new id when it posts, so counting
    # both would count it twice. Logins linked since the mark are left out: their first sync
    # loads months of history, which isn't news.
    new = one(
        conn,
        "SELECT count(*) AS n,"
        " -sum(CASE WHEN t.kind IN ('spend', 'refund') THEN t.amount ELSE 0 END) AS spent,"
        " sum(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END) AS income,"
        " -sum(CASE WHEN t.transfer_tag = 'invest' THEN t.amount ELSE 0 END) AS invested,"
        " count(CASE WHEN t.unmatched = 1 THEN 1 END) AS unmatched"
        " FROM transactions t JOIN accounts a ON a.id = t.account_id"
        " JOIN plaid_items i ON i.id = a.item_id"
        " WHERE t.created_at > ? AND t.pending = 0 AND i.created_at <= ?",
        (seen, seen),
    )
    new_n, spent, income = new["n"], new["spent"] or 0.0, new["income"] or 0.0
    invested, unmatched = new["invested"] or 0.0, new["unmatched"]
    linked = one(conn, "SELECT count(*) AS n FROM plaid_items WHERE created_at > ?", (seen,))["n"]
    newest = one(conn, "SELECT max(created_at) AS at FROM transactions")["at"]

    latest = net_worth_on(conn, "9999-12-31")
    change: Optional[float] = None
    since: Optional[str] = None
    base_nw, base_day = mark.get("net_worth"), mark.get("net_worth_day")
    if latest is not None and base_nw is None:
        prev = one(
            conn,
            "SELECT day, net_worth FROM v_net_worth_daily WHERE day < ? ORDER BY day DESC LIMIT 1",
            (latest["day"],),
        )
        if prev is not None:
            base_nw, base_day = prev["net_worth"], prev["day"]
    if latest is not None and base_nw is not None:
        change, since = latest["net_worth"] - base_nw, base_day
    # Investments move every day; only a move worth mentioning is news, measured from the
    # value last mentioned so small drifts add up instead of vanishing.
    moved = change is not None and abs(change) >= max(MOVE_MIN, MOVE_PCT * abs(latest["net_worth"]))

    parts: List[str] = []
    if stale:
        parts.append(f"⚠ no sync since {synced[:10]}" if synced else "⚠ never synced")
    if attention:
        parts.append(f"{attention} login{'s' if attention != 1 else ''} need{'s' if attention == 1 else ''} relinking")
    if latest is not None:
        nw = f"Net worth {short_money(latest['net_worth'])}"
        if moved:
            gap = since and date.fromisoformat(latest["day"]) - date.fromisoformat(since) > timedelta(days=1)
            nw += f" ({short_money(change, signed=True)}{f' since {since}' if gap else ''})"
        parts.append(nw)
    if new_n:
        txn = f"{new_n} new transaction{'s' if new_n != 1 else ''}"
        money_bits = []
        if spent >= 1:
            money_bits.append(f"{short_money(spent)} spent")
        if income >= 1:
            money_bits.append(f"{short_money(income)} in")
        if abs(invested) >= 1:
            money_bits.append(f"{short_money(invested)} invested")
        if money_bits:
            txn += ", " + ", ".join(money_bits)
        parts.append(txn)
    if unmatched:
        parts.append(f"{unmatched} card payment{'s' if unmatched != 1 else ''} to a card that isn't linked")
    if linked:
        parts.append(f"{linked} new login{'s' if linked != 1 else ''} linked")

    quiet = not (stale or attention or new_n or moved or linked)
    title = " · ".join(parts) if not quiet else "Nothing new in mycelium today"
    # The state is the fingerprint Resonant compares: coarse, and keyed on the snapshot day
    # so each day's summary is news once and a rerun of the same day is not.
    state = {
        "day": latest["day"] if latest is not None else None,
        "new": new_n,
        "linked": linked,
        "net_worth_k": round(latest["net_worth"] / 1000) if latest is not None else None,
        "stale_since": synced[:10] if stale and synced else ("never" if stale else None),
        "attention": attention,
    }
    # The next run counts from here. The net worth baseline only moves when a move was told
    # (or there was none to compare with), so the next change is measured from what you heard.
    next_mark = {"seen": max(seen, newest) if newest else seen}
    if latest is not None and (moved or base_nw is None):
        next_mark.update(net_worth=latest["net_worth"], net_worth_day=latest["day"])
    elif base_nw is not None:
        next_mark.update(net_worth=base_nw, net_worth_day=base_day)
    return {"title": title, "quiet": quiet, "state": state, "mark": next_mark}


def mark_file() -> Optional[Path]:
    data = os.environ.get("RESONANT_EXT_DATA")
    return Path(data) / MARK_FILE if data else None


def read_mark(path: Optional[Path]) -> Optional[Dict[str, Any]]:
    if path is None or not path.is_file():
        return None
    # A corrupt mark only costs one day's "new" count; never let it fail every run.
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(value, dict) or not isinstance(value.get("seen"), str):
        return None
    if not isinstance(value.get("net_worth"), (int, float, type(None))) or not isinstance(
        value.get("net_worth_day"), (str, type(None))
    ):
        value = {"seen": value["seen"]}
    return value


def write_mark(path: Optional[Path], mark: Dict[str, Any]) -> None:
    if path is None:
        return
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(mark))
    tmp.replace(path)


# ---------------------------------------------------------------- main


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="cli.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("net_worth")
    sub.add_parser("account_balances")
    r = sub.add_parser("recent_transactions")
    r.add_argument("--days", type=int, required=True)
    s = sub.add_parser("spending_summary")
    s.add_argument("--period", required=True)
    q = sub.add_parser("search_transactions")
    q.add_argument("--query", required=True)
    q.add_argument("--period", required=True)
    m = sub.add_parser("merchant_totals")
    m.add_argument("--period", required=True)
    m.add_argument("--limit", type=int, default=MERCHANT_LIMIT)
    sub.add_parser("daily")
    sub.add_parser("health")
    args = parser.parse_args(argv)

    now = datetime.now(timezone.utc)
    today = datetime.now().date()  # local: mycelium's days are local calendar days
    try:
        conn = connect()
        try:
            if args.cmd == "net_worth":
                out = net_worth(conn, today)
            elif args.cmd == "account_balances":
                out = account_balances(conn)
            elif args.cmd == "recent_transactions":
                out = recent_transactions(conn, args.days, today)
            elif args.cmd == "spending_summary":
                out = spending_summary(conn, args.period, today)
            elif args.cmd == "search_transactions":
                out = search_transactions(conn, args.query, args.period, today)
            elif args.cmd == "merchant_totals":
                out = merchant_totals(conn, args.period, args.limit, today)
            elif args.cmd == "daily":
                mark_path = mark_file()
                summary = daily_summary(conn, now, read_mark(mark_path))
                report(
                    REPORT_KEY,
                    summary["title"],
                    urgency="normal",
                    state=summary["state"],
                    ttl="24h",
                    quiet=summary["quiet"],
                )
                write_mark(mark_path, summary["mark"])
                out = {"summary": summary["title"], "quiet": summary["quiet"]}
            else:  # health
                one(conn, "SELECT count(*) FROM accounts")
                out = {"ok": True, "last_sync": last_sync(conn)}
        finally:
            conn.close()
    except (UserError, sqlite3.Error) as e:
        print(f"mycelium: {e}", file=sys.stderr)
        print(json.dumps({"error": str(e)}))
        return 1
    # Account and merchant names come from banks: Resonant treats every extension result as
    # untrusted (it taints the task), and says so here too.
    if args.cmd != "daily":
        out["untrusted"] = True
    print(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
