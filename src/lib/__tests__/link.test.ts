import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db/create";
import { accounts, plaidItems } from "../db/schema";
import { exchangePublicToken, findDuplicateItem } from "../link";
import { describeError } from "../plaid";

beforeAll(() => {
  process.env.MYCELIUM_ENC_KEY = randomBytes(32).toString("hex");
});

let db: Db;

function seedChase() {
  db.insert(plaidItems)
    .values({
      id: "old",
      institutionId: "ins_3",
      institutionName: "Chase",
      accessTokenEnc: "x",
      createdAt: "2026-01-01",
    })
    .run();
  db.insert(accounts)
    .values([
      {
        id: "a1",
        itemId: "old",
        name: "Total Checking",
        mask: "5817",
        type: "depository",
        subtype: "checking",
        updatedAt: "x",
      },
      {
        id: "a2",
        itemId: "old",
        name: "Sapphire",
        mask: "7360",
        type: "credit",
        subtype: "credit card",
        updatedAt: "x",
      },
    ])
    .run();
}

function fakePlaid(opts: { itemId: string; institutionId: string; accounts: object[]; removeFails?: boolean }) {
  const removed: string[] = [];
  const plaid = {
    itemPublicTokenExchange: async () => ({ data: { access_token: `access-${opts.itemId}`, item_id: opts.itemId } }),
    itemGet: async () => ({
      data: {
        item: {
          institution_id: opts.institutionId,
          institution_name: null,
          products: ["transactions"],
          billed_products: [],
        },
      },
    }),
    institutionsGetById: async () => ({ data: { institution: { name: "Chase" } } }),
    accountsGet: async () => ({ data: { accounts: opts.accounts } }),
    itemRemove: async ({ access_token }: { access_token: string }) => {
      if (opts.removeFails)
        throw Object.assign(new Error("x"), { response: { data: { error_code: "INTERNAL_SERVER_ERROR" } } });
      removed.push(access_token);
      return { data: {} };
    },
  };
  return { plaid: plaid as never, removed };
}

const acct = (mask: string | null, name: string, type: string, subtype: string | null) => ({
  account_id: `${name}-${mask}`,
  mask,
  name,
  type,
  subtype,
  balances: {},
});

beforeEach(() => {
  db = createDb(":memory:");
});

describe("findDuplicateItem", () => {
  beforeEach(seedChase);

  it("matches the same institution with an overlapping account", () => {
    expect(
      findDuplicateItem(db, "new", "ins_3", [
        { mask: "5817", name: "CHECKING", type: "depository", subtype: "checking" },
      ]),
    ).toMatchObject({ id: "old" });
  });

  it("ignores other institutions, other accounts, and update mode on the same item", () => {
    const k = [{ mask: "5817", name: "Total Checking", type: "depository", subtype: "checking" }];
    expect(findDuplicateItem(db, "new", "ins_99", k)).toBeNull();
    expect(
      findDuplicateItem(db, "new", "ins_3", [
        { mask: "9999", name: "Total Checking", type: "depository", subtype: "checking" },
      ]),
    ).toBeNull();
    expect(findDuplicateItem(db, "old", "ins_3", k)).toBeNull();
    expect(findDuplicateItem(db, "new", null, k)).toBeNull();
  });

  it("falls back to account name when the bank gives no mask", () => {
    db.insert(accounts)
      .values({
        id: "a3",
        itemId: "old",
        name: "Brokerage",
        mask: null,
        type: "investment",
        subtype: null,
        updatedAt: "x",
      })
      .run();
    expect(
      findDuplicateItem(db, "new", "ins_3", [{ mask: null, name: "brokerage", type: "investment", subtype: null }]),
    ).toMatchObject({ id: "old" });
  });
});

describe("exchangePublicToken", () => {
  it("stores a new login with its token encrypted", async () => {
    const { plaid } = fakePlaid({
      itemId: "new",
      institutionId: "ins_3",
      accounts: [acct("5817", "Checking", "depository", "checking")],
    });
    expect(await exchangePublicToken({ db, plaid }, "public-x")).toEqual({
      status: "linked",
      itemId: "new",
      institutionName: "Chase",
    });
    const row = db.select().from(plaidItems).get()!;
    expect(row.accessTokenEnc).not.toContain("access-new");
  });

  it("discards a duplicate login at Plaid and stores nothing", async () => {
    seedChase();
    const { plaid, removed } = fakePlaid({
      itemId: "new",
      institutionId: "ins_3",
      accounts: [acct("7360", "Sapphire Preferred", "credit", "credit card")],
    });
    const res = await exchangePublicToken({ db, plaid }, "public-x");
    expect(res).toEqual({
      status: "duplicate",
      existingItemId: "old",
      institutionName: "Chase",
      removedFromPlaid: true,
    });
    expect(removed).toEqual(["access-new"]);
    expect(
      db
        .select()
        .from(plaidItems)
        .all()
        .map((i) => i.id),
    ).toEqual(["old"]);
  });

  it("reports when Plaid wouldn't remove the duplicate", async () => {
    seedChase();
    const { plaid } = fakePlaid({
      itemId: "new",
      institutionId: "ins_3",
      accounts: [acct("5817", "Checking", "depository", "checking")],
      removeFails: true,
    });
    expect(await exchangePublicToken({ db, plaid }, "public-x")).toMatchObject({
      status: "duplicate",
      removedFromPlaid: false,
    });
  });
});

describe("describeError", () => {
  it("includes Plaid's request_id for support", () => {
    const err = {
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "login", request_id: "req123" } },
    };
    expect(describeError(err)).toBe("ITEM_LOGIN_REQUIRED: login (request_id req123)");
  });
});
