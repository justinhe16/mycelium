"""Tests for the mycelium extension. Stdlib only: python3 -m unittest discover resonant-extension/tests

The fixture database is built from mycelium's own drizzle migrations, so the queries run
against the real schema and views.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

EXT = Path(__file__).resolve().parents[1]
REPO = EXT.parent
sys.path.insert(0, str(EXT))

import cli  # noqa: E402

NOW = datetime(2026, 10, 21, 15, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 21)


def ts(dt: datetime) -> str:
    return cli.iso_utc(dt)


def build_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode = WAL")  # like mycelium's own connection
    for sql in sorted((REPO / "drizzle").glob("*.sql")):
        for stmt in sql.read_text().split("--> statement-breakpoint"):
            if stmt.strip():
                conn.executescript(stmt)
    created = ts(NOW - timedelta(days=30))
    conn.execute(
        "INSERT INTO plaid_items (id, institution_name, access_token_enc, created_at) VALUES"
        " ('item1', 'First Bank', 'x', ?), ('item2', 'Card Co', 'x', ?)",
        (created, created),
    )
    accounts = [
        ("chk", "item1", "Checking", "1111", "depository", "checking", 5000.0, 4900.0, 0, 0),
        ("sav", "item1", "Savings", "2222", "depository", "savings", 20000.0, None, 0, 0),
        ("card", "item2", "Rewards Card", "3333", "credit", "credit card", 1500.0, None, 1, 0),
        ("old", "item1", "Old Account", None, "depository", "checking", 100.0, None, 0, 1),
    ]
    conn.executemany(
        "INSERT INTO accounts (id, item_id, name, mask, type, subtype, current_balance,"
        " available_balance, is_liability, hidden, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [a + (created,) for a in accounts],
    )
    # Net worth by day: assets - card (hidden "old" never counts).
    snaps = {
        "2025-12-31": (20000.0, 1000.0),
        "2026-09-21": (23000.0, 1200.0),
        "2026-10-19": (24500.0, 1500.0),
        "2026-10-21": (25000.0, 1500.0),
    }
    for day, (assets, owed) in snaps.items():
        conn.execute(
            "INSERT INTO daily_snapshots VALUES (?, 'chk', ?, 0, ?), (?, 'card', ?, 1, ?),"
            " (?, 'old', 100, 0, ?)",
            (day, assets, created, day, owed, created, day, created),
        )
    old, fresh = ts(NOW - timedelta(days=3)), ts(NOW - timedelta(hours=8))
    txns = [
        # id, account, date, name, merchant, amount, pending, primary, kind, created_at
        ("t1", "chk", "2026-10-01", "ACME PAYROLL", None, 4000.0, 0, "INCOME", "income", old),
        ("t2", "card", "2026-10-05", "WHOLEFDS 123", "Whole Foods", -120.0, 0, "FOOD_AND_DRINK", "spend", old),
        ("t3", "card", "2026-10-06", "WHOLEFDS 456", "Whole Foods", -80.0, 0, "FOOD_AND_DRINK", "spend", old),
        ("t4", "chk", "2026-10-07", "RENT", None, -2000.0, 0, "RENT_AND_UTILITIES", "spend", old),
        ("t5", "card", "2026-10-08", "WHOLEFDS RETURN", "Whole Foods", 20.0, 0, "FOOD_AND_DRINK", "refund", old),
        ("t6", "chk", "2026-10-09", "CARD PAYMENT", None, -1500.0, 0, "LOAN_PAYMENTS", "transfer", old),
        ("t7", "card", "2026-10-20", "BLUE BOTTLE", "Blue Bottle", -6.5, 0, "FOOD_AND_DRINK", "spend", fresh),
        ("t8", "card", "2026-10-21", "UBER", "Uber", -24.0, 1, "TRANSPORTATION", "spend", fresh),
        ("t9", "chk", "2026-09-15", "ACME PAYROLL", None, 4000.0, 0, "INCOME", "income", old),
    ]
    conn.executemany(
        "INSERT INTO transactions (id, account_id, date, name, merchant_name, amount, pending,"
        " category_primary, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [t + (t[-1],) for t in txns],
    )
    conn.execute(
        "INSERT INTO sync_runs (started_at, finished_at, trigger, status) VALUES (?, ?, 'launchd', 'ok')",
        (ts(NOW - timedelta(hours=8, minutes=1)), ts(NOW - timedelta(hours=8))),
    )
    conn.commit()
    return conn


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "mycelium.db"
        self.rw = build_db(self.path)
        self.conn = cli.connect(self.path)

    def tearDown(self) -> None:
        self.conn.close()
        self.rw.close()
        self.tmp.cleanup()


class ReadOnly(Base):
    def test_connection_refuses_writes(self) -> None:
        with self.assertRaises(sqlite3.OperationalError):
            self.conn.execute("DELETE FROM transactions")
        self.assertEqual(self.rw.execute("SELECT count(*) FROM transactions").fetchone()[0], 9)

    def test_missing_database(self) -> None:
        with self.assertRaises(cli.UserError):
            cli.connect(Path(self.tmp.name) / "nope.db")

    def test_db_path_order(self) -> None:
        data = Path(self.tmp.name) / "data"
        data.mkdir()
        env = {"USER": "someone", "RESONANT_EXT_DATA": str(data)}
        with unittest.mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(cli.db_path(), Path("/Users/someone/code/mycelium/data/mycelium.db"))
            (data / "config.json").write_text(json.dumps({"database_path": "/x/m.db"}))
            self.assertEqual(cli.db_path(), Path("/x/m.db"))
            (data / "config.json").write_text(json.dumps({"database_path": "~/m.db"}))
            with self.assertRaises(cli.UserError):  # ~ would be the data dir under Resonant
                cli.db_path()
            os.environ["MYCELIUM_DB"] = "/y/m.db"
            self.assertEqual(cli.db_path(), Path("/y/m.db"))


class Tools(Base):
    def test_net_worth(self) -> None:
        out = cli.net_worth(self.conn, TODAY)
        self.assertEqual(out["as_of"], "2026-10-21")
        self.assertEqual(out["net_worth"], 23500.0)
        self.assertEqual(out["changes"], {"1d": 500.0, "30d": 1700.0, "ytd": 4500.0})
        self.assertEqual(out["last_sync"], ts(NOW - timedelta(hours=8)))

    def test_net_worth_without_snapshots(self) -> None:
        self.rw.execute("DELETE FROM daily_snapshots")
        self.rw.commit()
        out = cli.net_worth(self.conn, TODAY)
        self.assertIsNone(out["as_of"])
        self.assertEqual(out["net_worth"], 25000.0 - 1500.0)  # hidden account left out

    def test_account_balances(self) -> None:
        out = cli.account_balances(self.conn)
        self.assertEqual(out["count"], 4)
        self.assertEqual(out["assets"], 25000.0)
        self.assertEqual(out["liabilities"], 1500.0)
        by_name = {a["name"]: a for a in out["accounts"]}
        self.assertEqual(by_name["Checking ··1111"]["available"], 4900.0)
        self.assertTrue(by_name["Rewards Card ··3333"]["owed"])
        self.assertTrue(by_name["Old Account"]["hidden"])
        self.assertEqual(out["accounts"][-1]["name"], "Old Account")  # hidden last

    def test_recent_transactions(self) -> None:
        out = cli.recent_transactions(self.conn, 2, TODAY)
        self.assertEqual(out["since"], "2026-10-20")
        self.assertEqual([t["description"] for t in out["transactions"]], ["Uber", "Blue Bottle"])
        self.assertTrue(out["transactions"][0]["pending"])
        self.assertNotIn("pending", out["transactions"][1])
        self.assertEqual(out["transactions"][1]["account"], "Rewards Card ··3333")
        self.assertEqual(out["total"], 2)

    def test_recent_transactions_bounds(self) -> None:
        for days in (0, 91):
            with self.assertRaises(cli.UserError):
                cli.recent_transactions(self.conn, days, TODAY)

    def test_spending_summary_month(self) -> None:
        out = cli.spending_summary(self.conn, "this_month", TODAY)
        self.assertEqual((out["start"], out["end"]), ("2026-10-01", "2026-10-21"))
        self.assertEqual(out["income"], 4000.0)
        # 120 + 80 + 2000 + 6.5 - 20 refund; the transfer and the pending Uber are excluded.
        self.assertEqual(out["spend"], 2186.5)
        self.assertEqual(out["refunds"], 20.0)
        self.assertEqual(out["net"], 1813.5)
        self.assertEqual(out["by_category"][0], {"category": "RENT_AND_UTILITIES", "spent": 2000.0})
        self.assertEqual(out["by_category"][1], {"category": "FOOD_AND_DRINK", "spent": 186.5})
        self.assertEqual(out["top_merchants"][1], {"merchant": "Whole Foods", "spent": 200.0, "count": 2})
        self.assertEqual(out["pending"], {"count": 1, "spend": 24.0})

    def test_spending_summary_other_periods(self) -> None:
        self.assertEqual(cli.spending_summary(self.conn, "2026-09", TODAY)["income"], 4000.0)
        self.assertEqual(cli.spending_summary(self.conn, "ytd", TODAY)["income"], 8000.0)
        out = cli.spending_summary(self.conn, "2026-10-05..2026-10-06", TODAY)
        self.assertEqual(out["spend"], 200.0)

    def test_period_range(self) -> None:
        cases = {
            "last_month": (date(2026, 9, 1), date(2026, 9, 30)),
            "last_7_days": (date(2026, 10, 15), TODAY),
            "last_30_days": (date(2026, 9, 22), TODAY),
            "2026-12": (date(2026, 12, 1), date(2026, 12, 31)),
            "2024-02": (date(2024, 2, 1), date(2024, 2, 29)),
        }
        for period, want in cases.items():
            self.assertEqual(cli.period_range(period, TODAY), want, period)
        self.assertEqual(cli.period_range("last_month", date(2026, 1, 15)), (date(2025, 12, 1), date(2025, 12, 31)))
        for bad in ("yesterday", "2026-13", "2026-10-09..2026-10-01", "2026-02-30..2026-03-01", "'; DROP"):
            with self.assertRaises(cli.UserError, msg=bad):
                cli.period_range(bad, TODAY)

    def test_period_range_all_and_last_12_months(self) -> None:
        self.assertEqual(cli.period_range("last_12_months", TODAY), (date(2025, 10, 22), TODAY))
        self.assertEqual(cli.period_range("ALL", TODAY), (cli.ALL_START, TODAY))
        out = cli.spending_summary(self.conn, "all", TODAY)
        self.assertIsNone(out["start"])  # no made-up first day
        self.assertEqual(out["income"], 8000.0)


class Calibrated(Base):
    """Transfer tags and unmatched card payments, as mycelium's sync classifies them."""

    def add(self, tid: str, account: str, day: str, name: str, amount: float, kind: str,
            tag: str | None = None, unmatched: int = 0, pending: int = 0,
            created: datetime = NOW) -> None:
        self.rw.execute(
            "INSERT INTO transactions (id, account_id, date, name, amount, pending, kind, transfer_tag,"
            " unmatched, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, account, day, name, amount, pending, kind, tag, unmatched, ts(created), ts(created)),
        )
        self.rw.commit()

    def setUp(self) -> None:
        super().setUp()
        self.rw.execute("UPDATE transactions SET transfer_tag = 'card_payment' WHERE id = 't6'")
        self.add("c1", "card", "2026-10-10", "PAYMENT THANK YOU", 1500.0, "transfer", "card_payment")
        self.add("i1", "chk", "2026-10-11", "ROBINHOOD", -700.0, "transfer", "invest")
        self.add("i2", "chk", "2026-10-12", "ROBINHOOD WITHDRAWAL", 200.0, "transfer", "invest")
        self.add("u1", "chk", "2026-10-13", "OTHER CARD AUTOPAY", -310.0, "transfer", "card_payment", unmatched=1)
        self.add("v1", "chk", "2026-10-14", "VENMO", -60.0, "spend")
        self.add("v2", "chk", "2026-10-15", "VENMO", 25.0, "refund")
        self.add("i3", "chk", "2026-10-16", "ROBINHOOD", -50.0, "transfer", "invest", pending=1)

    def test_spending_summary_reports_invested_and_unmatched(self) -> None:
        out = cli.spending_summary(self.conn, "this_month", TODAY)
        # The base month's 2186.5, plus Venmo out 60, less the 25 payback; transfers stay out.
        self.assertEqual(out["spend"], 2221.5)
        self.assertEqual(out["refunds"], 45.0)
        self.assertEqual(out["income"], 4000.0)
        self.assertEqual(out["invested"], 500.0)  # 700 in, 200 back out; the pending 50 left out
        self.assertEqual(out["unmatched_card_payments"], {"count": 1, "total": 310.0})

    def test_spending_summary_without_any(self) -> None:
        out = cli.spending_summary(self.conn, "2026-09", TODAY)
        self.assertEqual(out["invested"], 0.0)
        self.assertEqual(out["unmatched_card_payments"], {"count": 0, "total": 0.0})

    def test_search_and_merchants_keep_transfers_out(self) -> None:
        out = cli.search_transactions(self.conn, "robinhood", "this_month", TODAY)
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["transfers_excluded"], {"count": 3, "net": -550.0})
        venmo = cli.search_transactions(self.conn, "venmo", "this_month", TODAY)
        self.assertEqual((venmo["count"], venmo["net"]), (2, -35.0))
        merchants = {m["merchant"]: m for m in cli.merchant_totals(self.conn, "this_month", 25, TODAY)["merchants"]}
        self.assertEqual(merchants["VENMO"], {"merchant": "VENMO", "spent": 35.0, "count": 2})
        self.assertNotIn("ROBINHOOD", merchants)
        self.assertNotIn("OTHER CARD AUTOPAY", merchants)

    def test_daily_mentions_invested_and_unmatched(self) -> None:
        out = cli.daily_summary(self.conn, NOW + timedelta(hours=1), {"seen": ts(NOW - timedelta(hours=1))})
        self.assertIn("$500 invested", out["title"])
        self.assertIn("1 card payment to a card that isn't linked", out["title"])


class Search(Base):
    def add(self, tid: str, day: str, name: str, amount: float, merchant: str | None = None,
            kind: str = "spend", category: str | None = None) -> None:
        self.rw.execute(
            "INSERT INTO transactions (id, account_id, date, name, merchant_name, amount, pending,"
            " category_primary, kind, created_at, updated_at) VALUES (?, 'card', ?, ?, ?, ?, 0, ?, ?, ?, ?)",
            (tid, day, name, merchant, amount, category, kind, ts(NOW), ts(NOW)),
        )
        self.rw.commit()

    def test_totals_and_rows(self) -> None:
        out = cli.search_transactions(self.conn, "whole foods", "this_month", TODAY)
        self.assertEqual(out["count"], 3)
        self.assertEqual((out["money_in"], out["money_out"], out["net"]), (20.0, 200.0, -180.0))
        self.assertEqual((out["first_date"], out["last_date"]), ("2026-10-05", "2026-10-08"))
        self.assertFalse(out["transfers_included"])
        self.assertFalse(out["truncated"])
        self.assertEqual([t["date"] for t in out["transactions"]], ["2026-10-08", "2026-10-06", "2026-10-05"])
        self.assertEqual(out["transactions"][0], {"date": "2026-10-08", "description": "Whole Foods",
                                                 "amount": 20.0, "kind": "refund",
                                                 "account": "Rewards Card ··3333"})
        self.assertNotIn("pending", out)
        self.assertNotIn("transfers_excluded", out)

    def test_matches_raw_name_and_is_case_insensitive(self) -> None:
        self.assertEqual(cli.search_transactions(self.conn, "WholeFDS 4", "all", TODAY)["count"], 1)
        out = cli.search_transactions(self.conn, "  payroll ", "ytd", TODAY)
        self.assertEqual((out["query"], out["count"], out["money_in"]), ("payroll", 2, 8000.0))
        self.assertEqual(cli.search_transactions(self.conn, "payroll", "2026-09", TODAY)["count"], 1)

    def test_matches_category(self) -> None:
        # "food and drink" finds FOOD_AND_DRINK: the 3 Whole Foods rows and Blue Bottle.
        out = cli.search_transactions(self.conn, "Food and Drink", "this_month", TODAY)
        self.assertEqual(out["count"], 4)
        self.assertEqual(out["money_out"], 206.5)

    def test_unicode_case_folding(self) -> None:
        self.add("u1", "2026-10-10", "CAFE ELENA", -4.0, merchant="Café Élena")
        self.assertEqual(cli.search_transactions(self.conn, "CAFÉ ÉLENA", "all", TODAY)["count"], 1)

    def test_transfers_are_excluded_and_counted(self) -> None:
        out = cli.search_transactions(self.conn, "card payment", "all", TODAY)
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["transactions"], [])
        self.assertEqual(out["transfers_excluded"], {"count": 1, "net": -1500.0})
        self.assertIsNone(out["first_date"])

    def test_pending_is_listed_but_not_totaled(self) -> None:
        out = cli.search_transactions(self.conn, "uber", "last_7_days", TODAY)
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["money_out"], 0.0)
        self.assertEqual(out["pending"], {"count": 1, "money_in": 0.0, "money_out": 24.0})
        self.assertTrue(out["transactions"][0]["pending"])

    def test_totals_cover_every_match_when_rows_are_cut(self) -> None:
        for i in range(40):
            self.add(f"c{i}", f"2026-08-{i % 28 + 1:02d}", f"SQ *NEIGHBOR COFFEE {i}", -5.0,
                     merchant="Neighbor Coffee Roasters Downtown")
        out = cli.search_transactions(self.conn, "neighbor coffee", "all", TODAY)
        self.assertEqual(out["count"], 40)
        self.assertEqual(out["money_out"], 200.0)
        self.assertEqual(out["shown"], cli.SEARCH_ROWS)
        self.assertTrue(out["truncated"])
        self.assertIn("newest 25 of 40 rows", out["note"])
        self.assertEqual(out["transactions"][0]["date"], "2026-08-28")
        # Totals come before the rows, and the whole result fits the model's 4 KB view.
        keys = list(out)
        self.assertLess(keys.index("money_out"), keys.index("transactions"))
        printed = json.dumps(out, separators=(",", ":"))  # as cli prints it
        self.assertLess(len(printed.encode()), 4096)

    def test_query_is_data_not_sql(self) -> None:
        for q in ("%", "'; DROP TABLE transactions; --", "\\"):
            self.assertEqual(cli.search_transactions(self.conn, q, "all", TODAY)["count"], 0, q)
        self.assertEqual(self.rw.execute("SELECT count(*) FROM transactions").fetchone()[0], 9)

    def test_bad_query_and_period(self) -> None:
        for q in ("", "   ", "x" * 65):
            with self.assertRaises(cli.UserError):
                cli.search_transactions(self.conn, q, "all", TODAY)
        with self.assertRaises(cli.UserError):
            cli.search_transactions(self.conn, "uber", "forever", TODAY)


class MerchantTotals(Base):
    def test_month(self) -> None:
        out = cli.merchant_totals(self.conn, "this_month", 25, TODAY)
        self.assertEqual(
            out["merchants"],
            [
                {"merchant": "RENT", "spent": 2000.0, "count": 1},
                {"merchant": "Whole Foods", "spent": 180.0, "count": 3},  # net of the refund
                {"merchant": "Blue Bottle", "spent": 6.5, "count": 1},
                {"merchant": "ACME PAYROLL", "spent": 0.0, "count": 1, "income": 4000.0},
            ],
        )
        # The same totals spending_summary reports: transfers and pending left out.
        summary = cli.spending_summary(self.conn, "this_month", TODAY)
        self.assertEqual((out["spend"], out["income"]), (summary["spend"], summary["income"]))
        self.assertEqual((out["merchant_count"], out["shown"], out["truncated"]), (4, 4, False))
        self.assertEqual(out["pending_excluded"], 1)
        self.assertFalse(out["transfers_included"])

    def test_limit_cuts_rows_not_totals(self) -> None:
        out = cli.merchant_totals(self.conn, "this_month", 1, TODAY)
        self.assertEqual([m["merchant"] for m in out["merchants"]], ["RENT"])
        self.assertTrue(out["truncated"])
        self.assertEqual((out["spend"], out["merchant_count"]), (2186.5, 4))

    def test_refunded_merchant_is_zero_not_minus_zero(self) -> None:
        self.assertEqual(str(cli.money(-0.0)), "0.0")
        self.assertEqual(str(cli.money(-0.001)), "0.0")

    def test_bounds(self) -> None:
        for limit in (0, 101):
            with self.assertRaises(cli.UserError):
                cli.merchant_totals(self.conn, "this_month", limit, TODAY)
        self.assertEqual(cli.merchant_totals(self.conn, "all", 100, TODAY)["income"], 8000.0)


class Daily(Base):
    def add_txn(self, tid: str, created: datetime, amount: float = -10.0, pending: int = 0,
                account: str = "card") -> None:
        self.rw.execute(
            "INSERT INTO transactions (id, account_id, date, name, amount, pending, kind, created_at,"
            " updated_at) VALUES (?, ?, ?, 'X', ?, ?, 'spend', ?, ?)",
            (tid, account, created.date().isoformat(), amount, pending, ts(created), ts(created)),
        )
        self.rw.commit()

    def test_new_activity_is_news(self) -> None:
        out = cli.daily_summary(self.conn, NOW)
        self.assertFalse(out["quiet"])
        # The pending Uber isn't counted until it posts; the snapshots are two days apart.
        self.assertEqual(out["title"], "Net worth $23.5k (+$500 since 2026-10-19) · 1 new transaction, $6 spent")
        self.assertEqual(
            out["state"],
            {"day": "2026-10-21", "new": 1, "linked": 0, "net_worth_k": 24, "stale_since": None,
             "attention": 0},
        )
        self.assertEqual(out["mark"], {"seen": ts(NOW - timedelta(hours=8)), "net_worth": 23500.0,
                                       "net_worth_day": "2026-10-21"})

    def test_new_counts_from_the_last_run(self) -> None:
        mark = cli.daily_summary(self.conn, NOW)["mark"]
        # The next sync is late (09:30) and so is the job (a day and 4 hours on): every row added
        # since the last run counts once, however the clocks fall.
        self.add_txn("n1", NOW + timedelta(hours=2))
        self.add_txn("n2", NOW + timedelta(hours=20))
        out = cli.daily_summary(self.conn, NOW + timedelta(days=1, hours=4), mark)
        self.assertEqual(out["state"]["new"], 2)
        out = cli.daily_summary(self.conn, NOW + timedelta(days=2), out["mark"])
        self.assertEqual(out["state"]["new"], 0)

    def test_pending_counts_once_when_it_posts(self) -> None:
        mark = cli.daily_summary(self.conn, NOW)["mark"]
        # Plaid removes the pending Uber and adds the posted one under a new id.
        self.rw.execute("DELETE FROM transactions WHERE id = 't8'")
        self.rw.commit()
        self.add_txn("t8-posted", NOW + timedelta(hours=18), amount=-24.0)
        out = cli.daily_summary(self.conn, NOW + timedelta(days=1), mark)
        self.assertEqual(out["state"]["new"], 1)
        self.assertIn("1 new transaction, $24 spent", out["title"])

    def test_new_login_backfill_is_not_new_spending(self) -> None:
        mark = cli.daily_summary(self.conn, NOW)["mark"]
        linked = ts(NOW + timedelta(hours=10))
        self.rw.execute(
            "INSERT INTO plaid_items (id, institution_name, access_token_enc, created_at)"
            " VALUES ('item3', 'New Bank', 'x', ?)", (linked,),
        )
        self.rw.execute(
            "INSERT INTO accounts (id, item_id, name, type, is_liability, hidden, updated_at)"
            " VALUES ('nb', 'item3', 'New Checking', 'depository', 0, 0, ?)", (linked,),
        )
        self.rw.commit()
        for i in range(50):
            self.add_txn(f"b{i}", NOW + timedelta(hours=10), amount=-100.0, account="nb")
        out = cli.daily_summary(self.conn, NOW + timedelta(days=1), mark)
        self.assertEqual(out["state"]["new"], 0)
        self.assertEqual(out["state"]["linked"], 1)
        self.assertIn("1 new login linked", out["title"])
        self.assertNotIn("spent", out["title"])
        # From the next run on, the new login's transactions count like any other.
        self.add_txn("b-next", NOW + timedelta(days=1, hours=2), account="nb")
        out = cli.daily_summary(self.conn, NOW + timedelta(days=2), out["mark"])
        self.assertEqual((out["state"]["new"], out["state"]["linked"]), (1, 0))

    def add_snapshot(self, day: str, assets: float) -> None:
        """A day's sync: a snapshot and an ok run, at 14:00 UTC."""
        recorded = ts(datetime.fromisoformat(day).replace(hour=14, tzinfo=timezone.utc))
        self.rw.execute(
            "INSERT INTO daily_snapshots VALUES (?, 'chk', ?, 0, ?), (?, 'card', 1500, 1, ?)",
            (day, assets, recorded, day, recorded),
        )
        self.rw.execute(
            "INSERT INTO sync_runs (started_at, finished_at, trigger, status) VALUES (?, ?, 'launchd', 'ok')",
            (recorded, recorded),
        )
        self.rw.commit()

    def test_small_net_worth_moves_add_up(self) -> None:
        mark = cli.daily_summary(self.conn, NOW)["mark"]  # told $23.5k
        later = NOW + timedelta(days=1)
        self.add_snapshot("2026-10-22", 25060.0)  # +$60: not news
        out = cli.daily_summary(self.conn, later, mark)
        self.assertTrue(out["quiet"])
        self.assertEqual(out["mark"]["net_worth"], 23500.0)  # baseline stays at what was told
        self.add_snapshot("2026-10-23", 25150.0)  # +$150 since the last mention: news
        out = cli.daily_summary(self.conn, later + timedelta(days=1), out["mark"])
        self.assertFalse(out["quiet"])
        self.assertIn("(+$150 since 2026-10-21)", out["title"])
        self.assertEqual(out["mark"]["net_worth"], 23650.0)

    def test_quiet_when_nothing_is_new(self) -> None:
        # Two days later, after a sync that found nothing and an unchanged balance.
        mark = cli.daily_summary(self.conn, NOW)["mark"]
        later = NOW + timedelta(days=2)
        self.rw.execute(
            "INSERT INTO daily_snapshots SELECT '2026-10-23', account_id, balance, is_liability, recorded_at"
            " FROM daily_snapshots WHERE day = '2026-10-21'"
        )
        self.rw.execute(
            "INSERT INTO sync_runs (started_at, finished_at, trigger, status) VALUES (?, ?, 'launchd', 'ok')",
            (ts(later - timedelta(hours=1)), ts(later - timedelta(hours=1))),
        )
        self.rw.commit()
        out = cli.daily_summary(self.conn, later, mark)
        self.assertTrue(out["quiet"])
        self.assertEqual(out["title"], "Nothing new in mycelium today")

    def test_stale_sync_and_broken_login_are_news(self) -> None:
        self.rw.execute("UPDATE plaid_items SET status = 'login_required' WHERE id = 'item2'")
        self.rw.commit()
        out = cli.daily_summary(self.conn, NOW + timedelta(days=3))
        self.assertFalse(out["quiet"])
        self.assertTrue(out["title"].startswith("⚠ no sync since 2026-10-21 · 1 login needs relinking"))
        self.assertEqual(out["state"]["stale_since"], "2026-10-21")

    def test_short_money(self) -> None:
        self.assertEqual(cli.short_money(23.4), "$23")
        self.assertEqual(cli.short_money(1234), "$1,234")
        self.assertEqual(cli.short_money(412345), "$412.3k")
        self.assertEqual(cli.short_money(2_500_000), "$2.50M")
        self.assertEqual(cli.short_money(-1200, signed=True), "-$1,200")


class Contract(Base):
    """The CLI as Resonant runs it: python -I -S, a scratch environment, events on fd 3."""

    def run_cli(self, *args: str, events: bool = False, data: Path | None = None) -> tuple:
        env = {"PATH": "/usr/bin:/bin", "MYCELIUM_DB": str(self.path), "HOME": self.tmp.name}
        if data is not None:
            env["RESONANT_EXT_DATA"] = env["HOME"] = str(data)
        r, w = os.pipe()
        if events:
            env["RESONANT_EVENTS_FD"] = str(w)  # pass_fds keeps the number in the child
        try:
            proc = subprocess.run(
                [sys.executable, "-I", "-S", str(EXT / "cli.py"), *args],
                env=env, capture_output=True, text=True, pass_fds=(w,) if events else (), timeout=30,
            )
        finally:
            os.close(w)
        with os.fdopen(r) as f:
            lines = [json.loads(line) for line in f.read().splitlines()]
        return proc, lines

    def test_each_tool_prints_one_json_object(self) -> None:
        for args in (
            ["net_worth"],
            ["account_balances"],
            ["recent_transactions", "--days", "7"],
            ["spending_summary", "--period", "last_30_days"],
            ["search_transactions", "--query=whole foods", "--period=all"],
            ["search_transactions", "--query=-x", "--period=ytd"],  # a leading "-" is a value
            ["merchant_totals", "--period=last_12_months", "--limit=25"],
            ["merchant_totals", "--period", "this_month"],  # --limit defaults to 25
            ["health"],
        ):
            proc, _ = self.run_cli(*args)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout)
            self.assertIsInstance(out, dict)
            self.assertEqual(proc.stdout.count("\n"), 1)

    def test_bad_input_fails_with_nonzero_exit(self) -> None:
        proc, _ = self.run_cli("spending_summary", "--period", "someday")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("period must be", json.loads(proc.stdout)["error"])
        proc, _ = self.run_cli("merchant_totals", "--period=all", "--limit=500")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("limit must be", json.loads(proc.stdout)["error"])

    def test_daily_reports_to_the_pulse(self) -> None:
        proc, events = self.run_cli("daily", events=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(events), 1)
        item = events[0]
        self.assertEqual(item["type"], "item")
        self.assertEqual(item["data"]["key"], "mycelium/daily")
        self.assertEqual(item["data"]["urgency"], "normal")
        self.assertIn(item["data"]["quiet"], (True, False))
        self.assertEqual(json.loads(proc.stdout)["summary"], item["text"])

    def test_daily_keeps_its_mark_in_the_data_dir(self) -> None:
        data = Path(self.tmp.name) / "ext-data"
        data.mkdir()
        proc, _ = self.run_cli("daily", data=data)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        mark = json.loads((data / "daily.json").read_text())
        self.assertIn("seen", mark)
        proc, _ = self.run_cli("daily", data=data)  # nothing added since: nothing new
        self.assertNotIn("new transaction", json.loads(proc.stdout)["summary"])

    def test_a_corrupt_mark_is_ignored(self) -> None:
        data = Path(self.tmp.name) / "ext-data"
        data.mkdir()
        for bad in ("{", "[]", '{"seen": 5}', '{"seen": "2026-10-20T00:00:00.000Z", "net_worth": "x"}'):
            (data / "daily.json").write_text(bad)
            proc, _ = self.run_cli("daily", data=data)
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_never_writes(self) -> None:
        self.rw.close()  # checkpoints the WAL into the main file
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        for args in (
            ["net_worth"],
            ["daily"],
            ["spending_summary", "--period", "ytd"],
            ["search_transactions", "--query=foods", "--period=all"],
            ["merchant_totals", "--period=all", "--limit=100"],
        ):
            self.assertEqual(self.run_cli(*args)[0].returncode, 0)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        self.rw = sqlite3.connect(self.path)


class Manifest(unittest.TestCase):
    def test_emit_is_the_sdk_copy(self) -> None:
        sdk = Path.home() / "resonant/packages/resonant-sdk/src/resonant_sdk/emit.py"
        if not sdk.is_file():
            self.skipTest("no resonant checkout")
        self.assertEqual((EXT / "emit.py").read_bytes(), sdk.read_bytes())

    def test_manifest_shape(self) -> None:
        text = (EXT / "resonant.yaml").read_text()
        for needle in (
            "name: mycelium",
            "effect: read",
            "report: {max_urgency: normal}",
            'schedule: "20 7 * * *"',
        ):
            self.assertIn(needle, text)
        keys = re.findall(r"^\s*([a-z_]+):", text, re.M)
        self.assertNotIn("secrets", keys)
        self.assertNotIn("approvers", keys)  # the owner approves; nobody else
        self.assertEqual(set(re.findall(r"effect: (\w+)", text)), {"read"})

    def test_resonant_validators_pass(self) -> None:
        """Resonant's own checks, run with its interpreter ($RESONANT_PYTHON or ~/resonant/.venv)."""
        python = Path(os.environ.get("RESONANT_PYTHON") or Path.home() / "resonant/.venv/bin/python")
        if not python.is_file():
            self.skipTest("no Resonant interpreter (set RESONANT_PYTHON)")
        check = (
            "import sys; from pathlib import Path\n"
            "from resonant_sdk import load_manifest\n"
            "from resonant.extensions.checks import name_errors, dir_errors\n"
            "root = Path(sys.argv[1]); m = load_manifest(root / 'resonant.yaml')\n"
            "errors = name_errors(m) + dir_errors(root, m)\n"
            "print(m.name); print('\\n'.join(errors)); sys.exit(1 if errors else 0)\n"
        )
        proc = subprocess.run([str(python), "-c", check, str(EXT)], capture_output=True, text=True,
                              timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(proc.stdout.split("\n")[0], "mycelium")


if __name__ == "__main__":
    unittest.main()
