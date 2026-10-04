/**
 * Fill a separate database with six months of made-up accounts, transactions
 * and daily balances, to try the UI (or agent queries) before linking anything.
 *
 *   npm run demo        # seeds data/demo.db, then serves it on :3002
 *
 * Refuses to touch a database that already has linked logins.
 */
import "./env";
import path from "node:path";
import { eq } from "drizzle-orm";
import { classify, isLiabilityType } from "../src/lib/classify";
import { addDays, todayIso } from "../src/lib/dates";
import { createDb } from "../src/lib/db/create";
import { accounts, dailySnapshots, plaidItems, transactions } from "../src/lib/db/schema";

const file = process.env.DATABASE_PATH ?? "data/demo.db";
if (!/demo/.test(path.basename(file))) {
  console.error(`Refusing to seed ${file}: the file name must contain "demo".`);
  process.exit(1);
}
const db = createDb(path.isAbsolute(file) ? file : path.join(process.cwd(), file));
if (db.select().from(plaidItems).all().some((i) => !i.id.startsWith("demo-"))) {
  console.error("This database has real linked logins; not seeding.");
  process.exit(1);
}

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const money = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100;

const now = new Date().toISOString();
const today = todayIso();
const DAYS = 180;
const start = addDays(today, -DAYS);

db.transaction((tx) => {
  tx.delete(plaidItems).run();
  const items = [
    { id: "demo-chase", institutionName: "Chase" },
    { id: "demo-empower", institutionName: "Empower" },
    { id: "demo-amex", institutionName: "American Express" },
  ];
  for (const i of items) {
    tx.insert(plaidItems).values({ ...i, accessTokenEnc: "demo", products: '["transactions"]', createdAt: now, lastSyncedAt: now }).run();
  }
  const accts = [
    { id: "demo-chk", itemId: "demo-chase", name: "Total Checking", mask: "5817", type: "depository", subtype: "checking", bal: 8200 },
    { id: "demo-sav", itemId: "demo-chase", name: "Chase Savings", mask: "3092", type: "depository", subtype: "savings", bal: 24000 },
    { id: "demo-sapphire", itemId: "demo-chase", name: "Sapphire Preferred", mask: "7360", type: "credit", subtype: "credit card", bal: 1450 },
    { id: "demo-401k", itemId: "demo-empower", name: "401(k)", mask: "2648", type: "investment", subtype: "401k", bal: 86000 },
    { id: "demo-gold", itemId: "demo-amex", name: "Gold Card", mask: "8153", type: "credit", subtype: "credit card", bal: 620 },
  ];
  for (const a of accts) {
    tx.insert(accounts)
      .values({
        id: a.id,
        itemId: a.itemId,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        currentBalance: a.bal,
        isoCurrency: "USD",
        isLiability: isLiabilityType(a.type),
        updatedAt: now,
      })
      .run();
  }

  const merchants: [string, string, string, number, number][] = [
    ["Blue Bottle Coffee", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", 4, 9],
    ["Sweetgreen", "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", 12, 19],
    ["Whole Foods", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", 40, 160],
    ["Amazon", "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", 15, 120],
    ["Uber", "TRANSPORTATION", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", 9, 38],
    ["Shell", "TRANSPORTATION", "TRANSPORTATION_GAS", 35, 70],
    ["Netflix", "ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES", 15.49, 15.49],
    ["Equinox", "PERSONAL_CARE", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", 260, 260],
    ["Delta Air Lines", "TRAVEL", "TRAVEL_FLIGHTS", 180, 540],
  ];
  let n = 0;
  const add = (accountId: string, date: string, name: string, amount: number, primary: string | null, detailed: string | null, pending = false) => {
    tx.insert(transactions)
      .values({
        id: `demo-t${++n}`,
        accountId,
        date,
        name: name.toUpperCase() + " #" + Math.floor(rand() * 9000 + 1000),
        merchantName: primary === "TRANSFER_IN" || primary === "TRANSFER_OUT" || primary === "LOAN_PAYMENTS" ? null : name,
        amount,
        isoCurrency: "USD",
        pending,
        categoryPrimary: primary,
        categoryDetailed: detailed,
        paymentChannel: "online",
        kind: classify(amount, primary, detailed),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  };

  const bal: Record<string, number> = { "demo-chk": 6000, "demo-sav": 20000, "demo-sapphire": 900, "demo-401k": 72000, "demo-gold": 300 };
  for (let i = 0; i <= DAYS; i++) {
    const day = addDays(start, i);
    const dom = Number(day.slice(8, 10));
    if (dom === 1 || dom === 15) {
      add("demo-chk", day, "Acme Corp Payroll", 4250, "INCOME", "INCOME_WAGES");
      bal["demo-chk"] += 4250;
      add("demo-chk", day, "Transfer to Savings", -800, "TRANSFER_OUT", "TRANSFER_OUT_SAVINGS");
      add("demo-sav", day, "Transfer from Checking", 800, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER");
      bal["demo-chk"] -= 800;
      bal["demo-sav"] += 800;
      bal["demo-401k"] += 950;
    }
    if (dom === 3) {
      add("demo-chk", day, "Rent - Parkside Apts", -2650, "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT");
      bal["demo-chk"] -= 2650;
    }
    if (dom === 20) {
      for (const card of ["demo-sapphire", "demo-gold"]) {
        const pay = Math.round(bal[card] * 100) / 100;
        add("demo-chk", day, card === "demo-gold" ? "AMEX EPAYMENT" : "CHASE CREDIT CRD AUTOPAY", -pay, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
        add(card, day, "Payment Thank You", pay, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
        bal["demo-chk"] -= pay;
        bal[card] = 0;
      }
    }
    if (dom === 28) {
      add("demo-sav", day, "Interest Payment", money(18, 26), "INCOME", "INCOME_INTEREST_EARNED");
    }
    const purchases = Math.floor(rand() * 3);
    for (let p = 0; p < purchases; p++) {
      const [m, pri, det, lo, hi] = pick(merchants);
      if (pri === "TRAVEL" && rand() > 0.15) continue;
      const card = rand() > 0.35 ? "demo-sapphire" : "demo-gold";
      const amt = money(lo, hi);
      add(card, day, m, -amt, pri, det, i >= DAYS - 1 && rand() > 0.5);
      bal[card] += amt;
    }
    if (rand() > 0.97) {
      const amt = money(10, 60);
      add("demo-sapphire", day, "Amazon", amt, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES");
      bal["demo-sapphire"] -= amt;
    }
    bal["demo-401k"] *= 1 + (rand() - 0.47) * 0.012;

    for (const [accountId, b] of Object.entries(bal)) {
      tx.insert(dailySnapshots)
        .values({ day, accountId, balance: Math.round(b * 100) / 100, isLiability: accountId === "demo-sapphire" || accountId === "demo-gold", recordedAt: now })
        .run();
    }
  }
  for (const [id, b] of Object.entries(bal)) {
    tx.update(accounts).set({ currentBalance: Math.round(b * 100) / 100 }).where(eq(accounts.id, id)).run();
  }
  console.log(`Seeded ${n} transactions and ${DAYS + 1} days of balances into ${file}.`);
});
