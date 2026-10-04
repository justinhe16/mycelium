import { db } from "@/lib/db";
import { queryLedger } from "@/lib/ledger";
import { parseLedgerQuery } from "@/lib/ledger-query";
import { fail } from "@/lib/route-helpers";

export const runtime = "nodejs";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /api/ledger?accounts=&kinds=&categories=&from=&to=&q=&pending=&sort=&dir=&page=&pageSize=[&format=csv] */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = parseLedgerQuery(params);

    if (params.get("format") === "csv") {
      const all = queryLedger(db, { ...query, page: 1, pageSize: 1_000_000 });
      const cols = ["date", "description", "amount", "currency", "kind", "categoryPrimary", "categoryDetailed", "pending", "institution", "accountName", "accountMask", "rawName", "id"] as const;
      const lines = [cols.join(","), ...all.rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
      return new Response(lines.join("\n") + "\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="mycelium-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return Response.json(queryLedger(db, query));
  } catch (err) {
    console.error("[GET /api/ledger]", err);
    return fail("Could not load the ledger.", 500);
  }
}
