import { describe, expect, it } from "vitest";
import { currentTotals, netWorthSeries, valueOn } from "../net-worth";

const snap = (day: string, accountId: string, balance: number, isLiability = false) => ({ day, accountId, balance, isLiability });

describe("netWorthSeries", () => {
  it("subtracts liabilities from assets", () => {
    const s = netWorthSeries([snap("2026-01-01", "chk", 1000), snap("2026-01-01", "card", 250, true)], "2026-01-01");
    expect(s).toEqual([{ day: "2026-01-01", assets: 1000, liabilities: 250, netWorth: 750, recorded: true }]);
  });

  it("carries the last balance forward across gaps, through today", () => {
    const s = netWorthSeries([snap("2026-01-01", "chk", 100), snap("2026-01-04", "chk", 160)], "2026-01-05");
    expect(s.map((p) => [p.day, p.netWorth, p.recorded])).toEqual([
      ["2026-01-01", 100, true],
      ["2026-01-02", 100, false],
      ["2026-01-03", 100, false],
      ["2026-01-04", 160, true],
      ["2026-01-05", 160, false],
    ]);
  });

  it("keeps an account that missed a day instead of dropping it to zero", () => {
    const s = netWorthSeries(
      [snap("2026-01-01", "a", 100), snap("2026-01-01", "b", 50), snap("2026-01-02", "a", 110)],
      "2026-01-02",
    );
    expect(s[1].netWorth).toBe(160);
  });

  it("adds an account from the day it first appears", () => {
    const s = netWorthSeries([snap("2026-01-01", "a", 100), snap("2026-01-02", "b", 40, true)], "2026-01-02");
    expect(s.map((p) => p.netWorth)).toEqual([100, 60]);
  });

  it("leaves out hidden accounts", () => {
    const s = netWorthSeries([snap("2026-01-01", "a", 100), snap("2026-01-01", "b", 900)], "2026-01-01", new Set(["b"]));
    expect(s[0].netWorth).toBe(100);
  });

  it("is empty with no data, and rounds to cents", () => {
    expect(netWorthSeries([], "2026-01-01")).toEqual([]);
    const s = netWorthSeries([snap("2026-01-01", "a", 0.1), snap("2026-01-01", "b", 0.2)], "2026-01-01");
    expect(s[0].netWorth).toBe(0.3);
  });
});

describe("valueOn", () => {
  const s = netWorthSeries([snap("2026-01-01", "a", 100), snap("2026-01-03", "a", 300)], "2026-01-03");
  it("looks up a day, or null before history starts", () => {
    expect(valueOn(s, "2025-12-31")).toBeNull();
    expect(valueOn(s, "2026-01-02")).toBe(100);
    expect(valueOn(s, "2026-01-03")).toBe(300);
    expect(valueOn(s, "2026-02-01")).toBe(300);
  });
});

describe("currentTotals", () => {
  it("skips hidden accounts and unknown balances", () => {
    expect(
      currentTotals([
        { currentBalance: 1000, isLiability: false, hidden: false },
        { currentBalance: 300, isLiability: true, hidden: false },
        { currentBalance: 5000, isLiability: false, hidden: true },
        { currentBalance: null, isLiability: false, hidden: false },
      ]),
    ).toEqual({ assets: 1000, liabilities: 300, netWorth: 700 });
  });
});
