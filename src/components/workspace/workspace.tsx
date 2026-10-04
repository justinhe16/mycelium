"use client";

import { useCallback, useState } from "react";

import { AccountsPanel } from "@/components/accounts/accounts-panel";
import { LedgerPanel } from "@/components/ledger/ledger-panel";
import { NetWorthPanel } from "@/components/net-worth/net-worth-panel";
import { useSnapshot } from "@/components/use-snapshot";
import { money } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { COLLAPSED_COOKIE, SECTION_IDS, serializeCollapsed, type SectionId, type SectionState } from "./sections";
import { SyncStatus } from "./sync-status";

type WorkspaceProps = { initial: Snapshot; initialCollapsed: SectionId[]; initialLedgerParams: string };

/** The whole app: one scrolling page with three collapsible sections. */
export function Workspace({ initial, initialCollapsed, initialLedgerParams }: WorkspaceProps) {
  const { snapshot, reload, sync, syncing, version } = useSnapshot(initial);
  const [collapsed, setCollapsed] = useState<SectionId[]>(initialCollapsed);

  const toggle = useCallback((id: SectionId) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      document.cookie = `${COLLAPSED_COOKIE}=${serializeCollapsed(next)}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  const section = (id: SectionId, summary?: React.ReactNode): SectionState => ({
    open: !collapsed.includes(id),
    onToggle: () => toggle(id),
    summary,
  });

  const visibleAccounts = snapshot.accounts.filter((a) => !a.hidden).length;
  const summaries: Record<SectionId, React.ReactNode> = {
    networth: snapshot.accounts.length ? money(snapshot.totals.netWorth, { whole: true }) : undefined,
    ledger: snapshot.transactionCount ? `${snapshot.transactionCount.toLocaleString()} transactions` : undefined,
    accounts: snapshot.accounts.length
      ? `${visibleAccounts} account${visibleAccounts === 1 ? "" : "s"} · ${snapshot.items.length} login${snapshot.items.length === 1 ? "" : "s"}`
      : undefined,
  };

  return (
    <div className="h-[calc(100dvh-3.25rem)] w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
        <SyncStatus snapshot={snapshot} syncing={syncing} onSync={() => void sync()} />
        {SECTION_IDS.map((id) => {
          const s = section(id, summaries[id]);
          if (id === "networth")
            return (
              <NetWorthPanel
                key={id}
                snapshot={snapshot}
                section={s}
                onOpenAccounts={() => collapsed.includes("accounts") && toggle("accounts")}
              />
            );
          if (id === "ledger")
            return (
              <LedgerPanel
                key={id}
                snapshot={snapshot}
                version={version}
                initialParams={initialLedgerParams}
                section={s}
              />
            );
          return (
            <AccountsPanel key={id} snapshot={snapshot} reload={reload} sync={sync} syncing={syncing} section={s} />
          );
        })}
      </div>
    </div>
  );
}
