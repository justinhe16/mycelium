import { describe, expect, it } from "vitest";
import { categoryLabel, classify, isLiabilityType, normalizeAmount } from "../classify";

describe("normalizeAmount", () => {
  it("flips Plaid's sign so inflows are positive", () => {
    expect(normalizeAmount(12.5)).toBe(-12.5); // purchase
    expect(normalizeAmount(-2000)).toBe(2000); // paycheck
    expect(Object.is(normalizeAmount(0), 0)).toBe(true);
  });
});

const CHECKING = { accountType: "depository", accountSubtype: "checking" };
const CARD = { accountType: "credit", accountSubtype: "credit card" };
const LOAN = { accountType: "loan", accountSubtype: "student" };
const BROKERAGE = { accountType: "investment", accountSubtype: "brokerage" };

const kindOf = (...args: Parameters<typeof classify>) => classify(...args).kind;

describe("classify", () => {
  it("1. treats card payments as card_payment transfers, both sides", () => {
    const cp = { kind: "transfer", tag: "card_payment" };
    expect(classify(-900, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", CHECKING)).toEqual(cp);
    expect(classify(900, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", CARD)).toEqual(cp);
    // No account context still works for the detailed category.
    expect(classify(-900, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toEqual(cp);
    // Chase sends the card side of a payment as a loan disbursement.
    expect(classify(1200, "LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT", CARD)).toEqual(cp);
    expect(classify(300, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER", CARD)).toEqual(cp);
    expect(classify(250, "LOAN_PAYMENTS", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", LOAN)).toEqual(cp);
  });

  it("does not call a loan disbursement into checking a card payment", () => {
    expect(classify(1200, "LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT", CHECKING)).toEqual({ kind: "refund", tag: null });
    // Money out on a card under LOAN_DISBURSEMENTS (a cash advance) is spend, not a payment.
    expect(classify(-200, "LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT", CARD)).toEqual({ kind: "spend", tag: null });
  });

  it("keeps other loan payments out of checking as spend", () => {
    expect(classify(-1800, "LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", CHECKING)).toEqual({ kind: "spend", tag: null });
  });

  it("2. tags moves to and from investment accounts as invest", () => {
    const inv = { kind: "transfer", tag: "invest" };
    expect(classify(-500, "TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", CHECKING)).toEqual(inv);
    expect(classify(500, "TRANSFER_IN", "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS", CHECKING)).toEqual(inv);
    expect(classify(500, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER", BROKERAGE)).toEqual(inv);
    expect(classify(-40, "GENERAL_MERCHANDISE", null, BROKERAGE)).toEqual(inv);
  });

  it("3. counts Venmo / Zelle / app payments out as spend and money back as a refund", () => {
    expect(classify(-60, "TRANSFER_OUT", "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS", CHECKING)).toEqual({ kind: "spend", tag: null });
    expect(classify(30, "TRANSFER_IN", "TRANSFER_IN_TRANSFER_IN_FROM_APPS", CHECKING)).toEqual({ kind: "refund", tag: null });
  });

  it("4. tags other moves between your accounts as internal", () => {
    const internal = { kind: "transfer", tag: "internal" };
    for (const [amount, primary, detailed] of [
      [-800, "TRANSFER_OUT", "TRANSFER_OUT_SAVINGS"],
      [-800, "TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
      [-100, "TRANSFER_OUT", "TRANSFER_OUT_WITHDRAWAL"],
      [800, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER"],
      [100, "TRANSFER_IN", "TRANSFER_IN_DEPOSIT"],
      [100, "TRANSFER_IN", "TRANSFER_IN_OTHER_TRANSFER_IN"],
    ] as const) {
      expect(classify(amount, primary, detailed, CHECKING)).toEqual(internal);
    }
  });

  it("5. labels income by category", () => {
    expect(classify(3000, "INCOME", "INCOME_WAGES", CHECKING)).toEqual({ kind: "income", tag: null });
    expect(kindOf(1.25, "INCOME", "INCOME_INTEREST_EARNED")).toBe("income");
  });

  it("5. splits everything else by direction", () => {
    expect(kindOf(-40, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", CARD)).toBe("spend");
    expect(kindOf(40, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", CARD)).toBe("refund");
    expect(kindOf(-10, null, null)).toBe("spend");
    expect(kindOf(10, null, null)).toBe("income");
  });
});

describe("helpers", () => {
  it("formats category codes", () => {
    expect(categoryLabel("FOOD_AND_DRINK")).toBe("Food and drink");
    expect(categoryLabel(null)).toBe("Uncategorized");
  });
  it("knows which account types are owed", () => {
    expect(isLiabilityType("credit")).toBe(true);
    expect(isLiabilityType("loan")).toBe(true);
    expect(isLiabilityType("depository")).toBe(false);
    expect(isLiabilityType("investment")).toBe(false);
  });
});
