/*
 * How a transaction counts toward cash flow. Pure, so it can be unit tested and
 * re-run over the whole table if the rules change (sync does, every run).
 *
 *   income   money earned (paychecks, interest, dividends)
 *   spend    money out to the world, including Venmo / Zelle / app payments out
 *   refund   money back from the world (returns, reimbursements, Venmo / Zelle paybacks)
 *   transfer moving your own money between accounts; excluded from income/spend so
 *            nothing is counted twice. Tagged:
 *              card_payment  paying a credit card or loan (both sides)
 *              invest        to or from an investment / retirement account
 *              internal      any other move between your own accounts
 */

export const KINDS = ["income", "spend", "refund", "transfer"] as const;
export type Kind = (typeof KINDS)[number];

export const TRANSFER_TAGS = ["card_payment", "invest", "internal"] as const;
export type TransferTag = (typeof TRANSFER_TAGS)[number];

export type Classification = { kind: Kind; tag: TransferTag | null };

/** The account a transaction sits on (Plaid's type and subtype). */
export type AccountContext = { accountType?: string | null; accountSubtype?: string | null };

const CARD_PAYMENT_DETAILED = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** Primaries Plaid uses for the card/loan side of a payment (Chase sends LOAN_DISBURSEMENTS). */
const LIABILITY_RECEIPT_PRIMARY = new Set(["LOAN_DISBURSEMENTS", "LOAN_PAYMENTS", "TRANSFER_IN"]);
const INVEST_DETAILED_SUFFIX = "_INVESTMENT_AND_RETIREMENT_FUNDS";
const INVESTMENT_TYPES = new Set(["investment", "brokerage"]);
const APPS_OUT = "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS";
const APPS_IN = "TRANSFER_IN_TRANSFER_IN_FROM_APPS";
const TRANSFER_PRIMARY = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

/** Plaid reports outflows as positive; we store inflows as positive. */
export function normalizeAmount(plaidAmount: number): number {
  return plaidAmount === 0 ? 0 : -plaidAmount;
}

const transfer = (tag: TransferTag): Classification => ({ kind: "transfer", tag });
const plain = (kind: Exclude<Kind, "transfer">): Classification => ({ kind, tag: null });

/**
 * `amount` is already normalized (positive = money in). Rules, first match wins:
 *   1. card payments: LOAN_PAYMENTS_CREDIT_CARD_PAYMENT anywhere, or money in on a credit
 *      or loan account under LOAN_DISBURSEMENTS / LOAN_PAYMENTS / TRANSFER_IN
 *   2. investing: *_INVESTMENT_AND_RETIREMENT_FUNDS, or any row on an investment account
 *   3. Venmo / Zelle / apps: out is spend, in is a refund (a payback)
 *   4. other TRANSFER_IN / TRANSFER_OUT: an internal transfer
 *   5. income by category; other money in is a refund (or income if uncategorized);
 *      everything else is spend
 */
export function classify(
  amount: number,
  primary?: string | null,
  detailed?: string | null,
  account: AccountContext = {},
): Classification {
  const p = primary?.toUpperCase() ?? "";
  const d = detailed?.toUpperCase() ?? "";
  const type = account.accountType?.toLowerCase() ?? "";

  if (d === CARD_PAYMENT_DETAILED) return transfer("card_payment");
  if ((type === "credit" || type === "loan") && amount > 0 && LIABILITY_RECEIPT_PRIMARY.has(p)) {
    return transfer("card_payment");
  }
  if (d.endsWith(INVEST_DETAILED_SUFFIX) || INVESTMENT_TYPES.has(type)) return transfer("invest");
  if (d === APPS_OUT) return plain("spend");
  if (d === APPS_IN) return plain("refund");
  if (TRANSFER_PRIMARY.has(p)) return transfer("internal");
  if (p === "INCOME") return plain("income");
  if (amount > 0) return plain(p ? "refund" : "income");
  return plain("spend");
}

/** "FOOD_AND_DRINK" -> "Food and drink" */
export function categoryLabel(code: string | null | undefined): string {
  if (!code) return "Uncategorized";
  const words = code.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Liabilities subtract from net worth: what you owe on credit cards and loans. */
export function isLiabilityType(type: string): boolean {
  return type === "credit" || type === "loan";
}
