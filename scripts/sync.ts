/**
 * Pull fresh data from Plaid and record today's balances.
 *
 *   npm run sync                      # what launchd runs every morning
 *   npm run sync -- --trigger=launchd
 */
import "./env";
import { setupProblems } from "../src/lib/plaid";
import { syncNow } from "../src/lib/server-sync";
import type { SyncTrigger } from "../src/lib/sync";

async function main() {
  const trigger = (process.argv.find((a) => a.startsWith("--trigger="))?.split("=")[1] ?? "cli") as SyncTrigger;
  const stamp = new Date().toISOString();

  const problems = setupProblems();
  if (problems.length) {
    console.error(`[${stamp}] Not configured: ${problems.join(" ")}`);
    process.exit(1);
  }

  const summary = await syncNow(trigger);
  if (summary.skipped) {
    console.log(`[${stamp}] Skipped: ${summary.reason}`);
    return;
  }
  console.log(`[${stamp}] Sync ${summary.status} (run #${summary.runId}, trigger=${trigger})`);
  for (const i of summary.items) {
    const detail = i.error ? ` -- ${i.error}` : ` -- ${i.accounts} accounts, +${i.added} ~${i.modified} -${i.removed} transactions, ${i.holdings} holdings`;
    console.log(`  ${i.status.padEnd(14)} ${i.institution}${detail}`);
  }
  console.log(`  Recorded ${summary.snapshotAccounts} balances for ${summary.snapshotDay}.`);
  if (summary.status === "error") process.exit(2);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Sync failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
