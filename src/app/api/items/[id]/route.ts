import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { describeError, plaidClient, plaidSettings } from "@/lib/plaid";
import { fail } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/items/:id -- disconnect a login. Tells Plaid to revoke the token
 * (which also stops billing), then drops its accounts, transactions, holdings and
 * balance history locally.
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const item = db.select().from(plaidItems).where(eq(plaidItems.id, id)).get();
  if (!item) return fail("Connection not found.", 404);

  let warning: string | null = null;
  if (plaidSettings()) {
    try {
      await plaidClient().itemRemove({ access_token: decrypt(item.accessTokenEnc) });
    } catch (err) {
      // Still remove locally; the user can revoke from the Plaid dashboard / my.plaid.com.
      warning = `Plaid did not confirm removal (${describeError(err)}).`;
      console.error("[DELETE /api/items/:id]", warning);
    }
  }
  db.delete(plaidItems).where(eq(plaidItems.id, id)).run();
  return Response.json({ ok: true, warning });
}
