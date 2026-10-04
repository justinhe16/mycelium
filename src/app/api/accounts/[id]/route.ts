import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { fail, readJson } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ hidden: z.boolean() }).strict();

/** PATCH /api/accounts/:id { hidden } -- the only local preference on an account. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = await readJson(request, schema);
  if ("error" in parsed) return parsed.error;
  const res = db.update(accounts).set({ hidden: parsed.data.hidden }).where(eq(accounts.id, id)).run();
  if (res.changes === 0) return fail("Account not found.", 404);
  return Response.json({ ok: true });
}
