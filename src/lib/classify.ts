/*
 * How a transaction counts toward cash flow. Pure, so it can be unit tested and
 * re-run over the whole table if the rules change.
 *
 *   income   money earned (paychecks, interest, dividends)
 *   spend    money out to the world
 *   refund   money back from the world (returns, reimbursements)
 *   transfer moving your own money between accounts, including credit card
 *            payments; excluded from income/spend so nothing is counted twice
 */

export const KINDS = ["income", "spend", "refund", "transfer"] as const;
export type Kind = (typeof KINDS)[number];

const TRANSFER_DETAILED = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);
const TRANSFER_PRIMARY = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

/** Plaid reports outflows as positive; we store inflows as positive. */
export function normalizeAmount(plaidAmount: number): number {
  return plaidAmount === 0 ? 0 : -plaidAmount;
}

/** `amount` is already normalized (positive = money in). */
export function classify(amount: number, primary?: string | null, detailed?: string | null): Kind {
  const p = primary?.toUpperCase() ?? "";
  const d = detailed?.toUpperCase() ?? "";
  if (TRANSFER_PRIMARY.has(p) || TRANSFER_DETAILED.has(d)) return "transfer";
  if (p === "INCOME") return "income";
  if (amount > 0) return p ? "refund" : "income";
  return "spend";
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
