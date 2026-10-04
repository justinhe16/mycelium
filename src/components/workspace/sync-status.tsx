"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/lib/types";

/** Last-synced line and a Sync button, under the rail. */
export function SyncStatus({ snapshot, syncing, onSync }: { snapshot: Snapshot; syncing: boolean; onSync: () => void }) {
  const configured = snapshot.setup.problems.length === 0;
  const lastOk = snapshot.runs.find((r) => r.status !== "running" && r.finishedAt);
  const broken = snapshot.items.filter((i) => i.status !== "ok").length;

  return (
    <div className="flex w-48 flex-col items-center gap-1.5 text-center">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!configured || syncing || snapshot.items.length === 0}
        onClick={onSync}
        title={configured ? "Pull fresh balances and transactions from Plaid" : "Add Plaid keys first"}
      >
        <RefreshCwIcon className={cn(syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
      <p className="text-muted-foreground text-[11px] leading-4" suppressHydrationWarning>
        {lastOk?.finishedAt
          ? `Synced ${formatDistanceToNowStrict(new Date(lastOk.finishedAt), { addSuffix: true })}`
          : "Never synced"}
        {snapshot.setup.env === "sandbox" && <span className="ml-1 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-400">sandbox</span>}
      </p>
      {broken > 0 && (
        <p className="text-destructive text-[11px] leading-4">
          {broken} connection{broken === 1 ? "" : "s"} need{broken === 1 ? "s" : ""} attention
        </p>
      )}
    </div>
  );
}
