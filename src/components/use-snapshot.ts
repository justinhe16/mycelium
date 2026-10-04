"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import type { Snapshot } from "@/lib/types";

/** Client copy of the server snapshot, plus a sync action that refreshes it. */
export function useSnapshot(initial: Snapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  /** Bumped after every sync so the ledger knows to refetch. */
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
      setVersion((v) => v + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not refresh.");
    }
  }, []);

  const sync = useCallback(
    async (itemIds?: string[]) => {
      setSyncing(true);
      try {
        const result = await api.sync(itemIds);
        const added = result.items.reduce((n, i) => n + i.added, 0);
        const failed = result.items.filter((i) => i.status !== "ok");
        if (failed.length) {
          toast.warning(`Synced with problems: ${failed.map((i) => i.institution).join(", ")}`, {
            description: failed[0].error,
          });
        } else {
          toast.success(added ? `Synced · ${added} new transaction${added === 1 ? "" : "s"}` : "Synced · up to date");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Sync failed.");
      } finally {
        setSyncing(false);
        await reload();
      }
    },
    [reload],
  );

  return { snapshot, reload, sync, syncing, version };
}
