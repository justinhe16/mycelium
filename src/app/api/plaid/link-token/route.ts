import { eq } from "drizzle-orm";
import { z } from "zod";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { plaidItems } from "@/lib/db/schema";
import { COUNTRY_CODES, describeError, LINK_MODES, plaidClient, setupProblems } from "@/lib/plaid";
import { fail, readJson } from "@/lib/route-helpers";

export const runtime = "nodejs";

const schema = z.union([
  z.object({ mode: z.enum(["bank", "investment"]) }).strict(),
  z.object({ itemId: z.string().min(1) }).strict(), // update mode: re-authenticate an existing login
]);

/** POST /api/plaid/link-token -- a short-lived token that opens Plaid Link in the browser. */
export async function POST(request: Request) {
  const problems = setupProblems();
  if (problems.length) return fail(problems.join(" "), 400);
  const parsed = await readJson(request, schema);
  if ("error" in parsed) return parsed.error;

  const base = {
    client_name: "Mycelium",
    language: "en",
    country_codes: COUNTRY_CODES,
    user: { client_user_id: "mycelium-local-user" },
  };

  try {
    if ("itemId" in parsed.data) {
      const item = db.select().from(plaidItems).where(eq(plaidItems.id, parsed.data.itemId)).get();
      if (!item) return fail("That connection no longer exists.", 404);
      const res = await plaidClient().linkTokenCreate({ ...base, access_token: decrypt(item.accessTokenEnc) });
      return Response.json({ linkToken: res.data.link_token });
    }
    const res = await plaidClient().linkTokenCreate({
      ...base,
      products: [...LINK_MODES[parsed.data.mode].products],
      // Ask for the full 24 months of history up front; it can't be extended later.
      ...(parsed.data.mode === "bank" && { transactions: { days_requested: 730 } }),
    });
    return Response.json({ linkToken: res.data.link_token });
  } catch (err) {
    console.error("[POST /api/plaid/link-token]", describeError(err));
    return fail(`Could not start Plaid Link: ${describeError(err)}`, 502);
  }
}
