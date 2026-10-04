import { cookies } from "next/headers";

import { Workspace } from "@/components/workspace/workspace";
import { PANELS_COOKIE, parsePanels } from "@/components/workspace/panels";
import { db } from "@/lib/db";
import { loadSnapshot } from "@/lib/queries";
import { catchUpIfNeeded } from "@/lib/server-sync";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  // Reading cookies makes the page dynamic, so the snapshot is always fresh.
  const panels = parsePanels((await cookies()).get(PANELS_COOKIE)?.value);
  // Ledger filters live in the query string; hand them over so the first render matches.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") params.set(k, v);
  catchUpIfNeeded();
  return <Workspace initial={loadSnapshot(db)} initialPanels={panels} initialLedgerParams={params.toString()} />;
}
