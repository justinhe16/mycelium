import { eq } from "drizzle-orm";

import { encrypt } from "./crypto";
import type { Db } from "./db/create";
import { plaidItems } from "./db/schema";
import { COUNTRY_CODES, type PlaidClient } from "./plaid";

/**
 * Swap a Link public token for an access token and store the Item, with the
 * token encrypted. Re-linking the same Item replaces its token in place.
 */
export async function exchangePublicToken(
  deps: { db: Db; plaid: Pick<PlaidClient, "itemPublicTokenExchange" | "itemGet" | "institutionsGetById"> },
  publicToken: string,
  institutionNameHint?: string | null,
): Promise<{ itemId: string; institutionName: string }> {
  const { db, plaid } = deps;
  const { access_token: accessToken, item_id: itemId } = (
    await plaid.itemPublicTokenExchange({ public_token: publicToken })
  ).data;

  const item = (await plaid.itemGet({ access_token: accessToken })).data.item;
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
  else db.insert(plaidItems).values({ id: itemId, ...values, createdAt: new Date().toISOString() }).run();

  return { itemId, institutionName };
}
