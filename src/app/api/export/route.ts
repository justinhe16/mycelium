import { connection } from "next/server";
import { db } from "@/lib/db";
import { accounts, dailySnapshots, holdings, plaidItems, syncRuns, transactions } from "@/lib/db/schema";

export const runtime = "nodejs";

/** GET /api/export -- everything as JSON, minus access tokens. */
export async function GET() {
  await connection();
  const items = db
    .select({
      id: plaidItems.id,
      institutionId: plaidItems.institutionId,
      institutionName: plaidItems.institutionName,
      products: plaidItems.products,
      status: plaidItems.status,
      errorCode: plaidItems.errorCode,
      createdAt: plaidItems.createdAt,
      lastSyncedAt: plaidItems.lastSyncedAt,
    })
    .from(plaidItems)
    .all();
  const body = {
    app: "mycelium",
    exportedAt: new Date().toISOString(),
    items,
    accounts: db.select().from(accounts).all(),
    transactions: db.select().from(transactions).all(),
    holdings: db.select().from(holdings).all(),
    dailySnapshots: db.select().from(dailySnapshots).all(),
    syncRuns: db.select().from(syncRuns).all(),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mycelium-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
