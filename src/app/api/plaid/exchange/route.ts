import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { exchangePublicToken } from "@/lib/link";
import { describeError, plaidClient } from "@/lib/plaid";
import { fail, readJson } from "@/lib/route-helpers";
import { syncNow } from "@/lib/server-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.union([
  z.object({ publicToken: z.string().min(1), institutionName: z.string().nullish() }).strict(),
  z.object({ relinkedItemId: z.string().min(1) }).strict(),
]);

/**
 * POST /api/plaid/exchange
 *   { publicToken }      a new login from Link: store it, then sync it
 *   { relinkedItemId }   update mode finished: the old token works again, so just sync
 */
export async function POST(request: Request) {
  const parsed = await readJson(request, schema);
  if ("error" in parsed) return parsed.error;

  try {
    let itemId: string;
    let institutionName: string;
    if ("publicToken" in parsed.data) {
      const res = await exchangePublicToken(
        { db, plaid: plaidClient() },
        parsed.data.publicToken,
        parsed.data.institutionName,
      );
      if (res.status === "duplicate") {
        // Plaid bills each login separately, so a second copy of one is discarded.
        return fail(
          `${res.institutionName} is already linked. Use Re-authenticate on it instead.` +
            (res.removedFromPlaid
              ? " The duplicate was discarded."
              : " Plaid didn't confirm removing the duplicate; check the server log."),
          409,
        );
      }
      ({ itemId, institutionName } = res);
    } else {
      const item = db.select().from(plaidItems).where(eq(plaidItems.id, parsed.data.relinkedItemId)).get();
      if (!item) return fail("That connection no longer exists.", 404);
      itemId = item.id;
      institutionName = item.institutionName;
    }

    const summary = await syncNow("link", { itemIds: [itemId] });
    return Response.json({ itemId, institutionName, sync: summary });
  } catch (err) {
    console.error("[POST /api/plaid/exchange]", describeError(err));
    return fail(`Could not finish linking: ${describeError(err)}`, 502);
  }
}
