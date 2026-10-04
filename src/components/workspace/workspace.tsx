"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { AccountsPanel } from "@/components/accounts/accounts-panel";
import { LedgerPanel } from "@/components/ledger/ledger-panel";
import { NetWorthPanel } from "@/components/net-worth/net-worth-panel";
import { useSnapshot } from "@/components/use-snapshot";
import { moneyCompact } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { PANEL_IDS, PANELS, PANELS_COOKIE, serializePanels, type PanelId } from "./panels";
import { Rail } from "./rail";
import { SyncStatus } from "./sync-status";

type WorkspaceProps = { initial: Snapshot; initialPanels: PanelId[]; initialLedgerParams: string };

/**
 * The whole app: a floating rail of panel toggles, plus one column per open
 * panel, laid out left to right in a fixed order and centered.
 */
export function Workspace({ initial, initialPanels, initialLedgerParams }: WorkspaceProps) {
  const { snapshot, reload, sync, syncing, version } = useSnapshot(initial);
  const [open, setOpen] = useState<PanelId[]>(initialPanels);

  const update = useCallback((next: (prev: PanelId[]) => PanelId[]) => {
    setOpen((prev) => {
      const value = PANEL_IDS.filter((id) => next(prev).includes(id));
      document.cookie = `${PANELS_COOKIE}=${serializePanels(value)}; path=/; max-age=31536000; samesite=lax`;
      return value;
    });
  }, []);

  const toggle = useCallback(
    (id: PanelId) => update((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])),
    [update],
  );
  const show = (id: PanelId) => update((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const close = (id: PanelId) => () => update((prev) => prev.filter((p) => p !== id));

  // 1–3 toggle panels, unless typing or a modal is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const id = PANEL_IDS.find((p) => PANELS[p].shortcut === e.key);
      if (id) toggle(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const badges = useMemo(() => {
    const visible = snapshot.accounts.filter((a) => !a.hidden).length;
    return {
      networth: snapshot.accounts.length ? moneyCompact(snapshot.totals.netWorth) : undefined,
      ledger: snapshot.transactionCount ? snapshot.transactionCount.toLocaleString() : undefined,
      accounts: visible || undefined,
    };
  }, [snapshot]);

  const renderPanel: Record<PanelId, () => React.ReactNode> = {
    networth: () => <NetWorthPanel snapshot={snapshot} onOpenAccounts={() => show("accounts")} onClose={close("networth")} />,
    ledger: () => (
      <LedgerPanel snapshot={snapshot} version={version} initialParams={initialLedgerParams} onClose={close("ledger")} />
    ),
    accounts: () => <AccountsPanel snapshot={snapshot} reload={reload} sync={sync} syncing={syncing} onClose={close("accounts")} />,
  };

  return (
    // Fills the viewport under the header. Scrolls sideways only when the columns don't fit.
    <div className="h-[calc(100dvh-3.25rem)] w-full overflow-x-auto overflow-y-hidden">
      <div className="mx-auto flex h-full w-fit items-center gap-4 px-4 sm:px-6">
        <Rail
          open={open}
          onToggle={toggle}
          badges={badges}
          footer={<SyncStatus snapshot={snapshot} syncing={syncing} onSync={() => void sync()} />}
        />

        {open.map((id) => (
          <Fragment key={id}>{renderPanel[id]()}</Fragment>
        ))}
      </div>
    </div>
  );
}
