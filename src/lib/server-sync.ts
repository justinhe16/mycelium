import { decrypt } from "./crypto";
import { todayIso } from "./dates";
import { db } from "./db";
import { plaidClient, plaidSettings, setupProblems } from "./plaid";
import { hasSnapshotFor, runSync, type SyncSummary, type SyncTrigger } from "./sync";
import { plaidItems } from "./db/schema";

/** runSync wired to the real DB and Plaid client. */
export function syncNow(trigger: SyncTrigger, opts: { itemIds?: string[] } = {}): Promise<SyncSummary> {
  return runSync({ db, plaid: plaidClient(), decrypt: (s) => decrypt(s) }, trigger, opts);
}

const globalForBoot = globalThis as unknown as { __myceliumCatchUp?: string };

/**
 * Catch-up on boot: if nothing has been recorded for today (the Mac was off at
 * 07:00, say), start a sync in the background. Fires at most once per day per
 * server process; never blocks the page.
 */
export function catchUpIfNeeded() {
  const today = todayIso();
  if (globalForBoot.__myceliumCatchUp === today) return;
  globalForBoot.__myceliumCatchUp = today;
  try {
    if (setupProblems().length || !plaidSettings()) return;
    if (!db.select({ id: plaidItems.id }).from(plaidItems).limit(1).get()) return;
    if (hasSnapshotFor(db, today)) return;
  } catch {
    return;
  }
  void syncNow("boot").catch((err) => console.error("[catch-up sync]", err instanceof Error ? err.message : err));
}
