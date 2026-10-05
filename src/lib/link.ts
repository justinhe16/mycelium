import { eq } from "drizzle-orm";

import { encrypt } from "./crypto";
import type { Db } from "./db/create";
import { accounts, plaidItems } from "./db/schema";
import { COUNTRY_CODES, describeError, type PlaidClient } from "./plaid";

type LinkDeps = {
  db: Db;
  plaid: Pick<
    PlaidClient,
    "itemPublicTokenExchange" | "itemGet" | "institutionsGetById" | "accountsGet" | "itemRemove"
  >;
};

export type ExchangeResult =
  | { status: "linked"; itemId: string; institutionName: string }
  | { status: "duplicate"; existingItemId: string; institutionName: string; removedFromPlaid: boolean };

export type AccountKey = { mask: string | null; name: string; type: string; subtype: string | null };

/**
 * The login already stored for this institution that shares an account with the
 * new one, if any. Plaid's recommended check: same institution_id, and an account
 * matching on mask + type + subtype (or on name, when the bank gives no mask).
 */
export function findDuplicateItem(
  db: Db,
  newItemId: string,
  institutionId: string | null,
  newAccounts: AccountKey[],
): { id: string; institutionName: string } | null {
  if (!institutionId) return null;
  const candidates = db
    .select({ id: plaidItems.id, institutionName: plaidItems.institutionName })
    .from(plaidItems)
    .where(eq(plaidItems.institutionId, institutionId))
    .all()
    .filter((i) => i.id !== newItemId); // same item_id = update mode on the same login, not a duplicate

  const key = (a: AccountKey) =>
    a.mask ? `m:${a.mask}|${a.type}|${a.subtype ?? ""}` : `n:${a.name.toLowerCase()}|${a.type}`;
  const incoming = new Set(newAccounts.map(key));
  for (const item of candidates) {
    const existing = db
      .select({ mask: accounts.mask, name: accounts.name, type: accounts.type, subtype: accounts.subtype })
      .from(accounts)
      .where(eq(accounts.itemId, item.id))
      .all();
    if (existing.some((a) => incoming.has(key(a)))) return item;
  }
  return null;
}

/**
 * Swap a Link public token for an access token and store the Item, with the
 * token encrypted. Re-linking the same Item replaces its token in place.
 *
 * If the login duplicates one already stored (Plaid would bill both), the new
 * Item is removed at Plaid and nothing is stored.
 */
export async function exchangePublicToken(
  deps: LinkDeps,
  publicToken: string,
  institutionNameHint?: string | null,
): Promise<ExchangeResult> {
  const { db, plaid } = deps;
  const { access_token: accessToken, item_id: itemId } = (
    await plaid.itemPublicTokenExchange({ public_token: publicToken })
  ).data;

  const item = (await plaid.itemGet({ access_token: accessToken })).data.item;

  const newAccounts = (await plaid.accountsGet({ access_token: accessToken })).data.accounts.map((a) => ({
    mask: a.mask ?? null,
    name: a.name,
    type: String(a.type),
    subtype: a.subtype ? String(a.subtype) : null,
  }));
  const duplicate = findDuplicateItem(db, itemId, item.institution_id ?? null, newAccounts);
  if (duplicate) {
    let removedFromPlaid = true;
    try {
      await plaid.itemRemove({ access_token: accessToken });
    } catch (err) {
      removedFromPlaid = false;
      console.error("[link] could not remove duplicate Item at Plaid:", describeError(err));
    }
    return {
      status: "duplicate",
      existingItemId: duplicate.id,
      institutionName: duplicate.institutionName,
      removedFromPlaid,
    };
  }

  let institutionName = institutionNameHint ?? item.institution_name ?? null;
  if (!institutionName && item.institution_id) {
    try {
      institutionName = (
        await plaid.institutionsGetById({ institution_id: item.institution_id, country_codes: COUNTRY_CODES })
      ).data.institution.name;
    } catch {
      // Cosmetic only; fall through to the placeholder.
    }
  }
  institutionName ??= "Unknown institution";

  const products = JSON.stringify([...new Set([...(item.products ?? []), ...(item.billed_products ?? [])])].sort());
  const values = {
    institutionId: item.institution_id ?? null,
    institutionName,
    accessTokenEnc: encrypt(accessToken),
    products,
    status: "ok" as const,
    errorCode: null,
    errorMessage: null,
  };
  const existing = db.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.id, itemId)).get();
  if (existing) db.update(plaidItems).set(values).where(eq(plaidItems.id, itemId)).run();
  else
    db.insert(plaidItems)
      .values({ id: itemId, ...values, createdAt: new Date().toISOString() })
      .run();

  return { status: "linked", itemId, institutionName };
}
