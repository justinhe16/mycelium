import { connection } from "next/server";
import { db } from "@/lib/db";
import { loadSnapshot } from "@/lib/queries";
import { fail } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET() {
  await connection();
  try {
    return Response.json(loadSnapshot(db));
  } catch (err) {
    console.error("[GET /api/snapshot]", err);
    return fail("Could not load data.", 500);
  }
}
