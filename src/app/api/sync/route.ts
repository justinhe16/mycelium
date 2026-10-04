import { z } from "zod";
import { setupProblems } from "@/lib/plaid";
import { fail, readJson } from "@/lib/route-helpers";
import { syncNow } from "@/lib/server-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ itemIds: z.array(z.string()).optional() }).strict();

export async function POST(request: Request) {
  const problems = setupProblems();
  if (problems.length) return fail(problems.join(" "), 400);
  const parsed = await readJson(request, schema);
  if ("error" in parsed) return parsed.error;
  try {
    const summary = await syncNow("manual", { itemIds: parsed.data.itemIds });
    if (summary.skipped) return fail(summary.reason, 409);
    return Response.json(summary);
  } catch (err) {
    console.error("[POST /api/sync]", err instanceof Error ? err.message : err);
    return fail("Sync failed. Check the server log.", 500);
  }
}
