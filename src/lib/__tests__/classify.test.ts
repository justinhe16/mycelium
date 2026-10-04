import { describe, expect, it } from "vitest";
import { categoryLabel, classify, isLiabilityType, normalizeAmount } from "../classify";

describe("normalizeAmount", () => {
  it("flips Plaid's sign so inflows are positive", () => {
    expect(normalizeAmount(12.5)).toBe(-12.5); // purchase
    expect(normalizeAmount(-2000)).toBe(2000); // paycheck
    expect(Object.is(normalizeAmount(0), 0)).toBe(true);
  });
});

describe("classify", () => {
  it("treats transfers and card payments as transfers, whatever the sign", () => {
    expect(classify(-500, "TRANSFER_OUT", "TRANSFER_OUT_SAVINGS")).toBe("transfer");
    expect(classify(500, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER")).toBe("transfer");
    expect(classify(-900, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe("transfer");
    expect(classify(900, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe("transfer");
  });

  it("keeps other loan payments as spend", () => {
    expect(classify(-1800, "LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT")).toBe("spend");
  });

  it("labels income by category", () => {
    expect(classify(3000, "INCOME", "INCOME_WAGES")).toBe("income");
    expect(classify(1.25, "INCOME", "INCOME_INTEREST_EARNED")).toBe("income");
  });

  it("splits everything else by direction", () => {
    expect(classify(-40, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT")).toBe("spend");
    expect(classify(40, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES")).toBe("refund");
    expect(classify(-10, null, null)).toBe("spend");
    expect(classify(10, null, null)).toBe("income");
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
