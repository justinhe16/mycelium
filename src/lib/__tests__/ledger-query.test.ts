import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, parseLedgerQuery, serializeLedgerQuery } from "../ledger-query";

describe("ledger query params", () => {
  it("defaults to newest first, everything included", () => {
    expect(parseLedgerQuery(new URLSearchParams())).toEqual(DEFAULT_QUERY);
    expect(serializeLedgerQuery(DEFAULT_QUERY).toString()).toBe("");
  });

  it("round-trips a full filter set", () => {
    const q = {
      ...DEFAULT_QUERY,
      accounts: ["a1", "a2"],
      kinds: ["spend" as const, "income" as const],
      categories: ["FOOD_AND_DRINK", "UNCATEGORIZED"],
      from: "2026-01-01",
      to: "2026-01-31",
      q: "coffee",
      pending: "exclude" as const,
      sort: "amount" as const,
      dir: "asc" as const,
      page: 3,
    };
    const parsed = parseLedgerQuery(serializeLedgerQuery(q));
    expect(parsed).toEqual(q);
  });

  it("ignores junk", () => {
    const q = parseLedgerQuery(new URLSearchParams("kinds=spend,bogus&sort=evil&dir=sideways&from=2026-13-01&page=-2&pageSize=99999&pending=x"));
    expect(q.kinds).toEqual(["spend"]);
    expect(q.sort).toBe("date");
    expect(q.dir).toBe("desc");
    expect(q.from).toBeNull();
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(500);
    expect(q.pending).toBe("include");
  });
});
