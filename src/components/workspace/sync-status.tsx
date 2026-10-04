"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/lib/types";

/** The bar above the sections: last-synced line, problems, and a Sync button. */
export function SyncStatus({
  snapshot,
  syncing,
  onSync,
}: {
  snapshot: Snapshot;
  syncing: boolean;
  onSync: () => void;
}) {
  const configured = snapshot.setup.problems.length === 0;
  const lastOk = snapshot.runs.find((r) => r.status !== "running" && r.finishedAt);
  const broken = snapshot.items.filter((i) => i.status !== "ok").length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <p className="text-muted-foreground text-xs" suppressHydrationWarning>
        {lastOk?.finishedAt
          ? `Synced ${formatDistanceToNowStrict(new Date(lastOk.finishedAt), { addSuffix: true })}`
          : "Never synced"}
      </p>
      {snapshot.setup.env === "sandbox" && (
        <span className="rounded bg-amber-500/15 px-1.5 text-[11px] text-amber-700 dark:text-amber-400">sandbox</span>
      )}
      {broken > 0 && (
        <span className="text-destructive text-xs">
          {broken} connection{broken === 1 ? "" : "s"} need{broken === 1 ? "s" : ""} attention
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        disabled={!configured || syncing || snapshot.items.length === 0}
        onClick={onSync}
        title={configured ? "Pull fresh balances and transactions from Plaid" : "Add Plaid keys first"}
      >
        <RefreshCwIcon className={cn(syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
