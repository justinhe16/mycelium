"use client";

import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangleIcon,
  BuildingIcon,
  EyeIcon,
  EyeOffIcon,
  LandmarkIcon,
  LineChartIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Panel, PanelEmpty, PanelLabel } from "@/components/workspace/panel";
import { api } from "@/lib/api-client";
import { money } from "@/lib/format";
import type { ItemView, Snapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlaidLinkLauncher } from "./plaid-link";
import { SetupCard } from "./setup-card";

type Props = {
  snapshot: Snapshot;
  reload: () => Promise<void>;
  sync: (itemIds?: string[]) => Promise<void>;
  syncing: boolean;
  onClose: () => void;
};

type LinkSession = { token: string; relinkItemId: string | null };

const STATUS_LABEL: Record<ItemView["status"], string> = {
  ok: "Connected",
  login_required: "Needs re-login",
  error: "Error",
};

function ago(iso: string | null) {
  return iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : "never";
}

export function AccountsPanel({ snapshot, reload, sync, syncing, onClose }: Props) {
  const [link, setLink] = useState<LinkSession | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ItemView | null>(null);
  const configured = snapshot.setup.problems.length === 0;

  async function startLink(input: { mode: "bank" | "investment" } | { itemId: string }) {
    const tag = "mode" in input ? input.mode : input.itemId;
    setStarting(tag);
    try {
      const token = await api.linkToken(input);
      setLink({ token, relinkItemId: "itemId" in input ? input.itemId : null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start Plaid Link.");
    } finally {
      setStarting(null);
    }
  }

  async function finishLink(session: LinkSession, publicToken: string | null, institutionName: string | null) {
    setLinking(true);
    const pending = toast.loading(session.relinkItemId ? "Reconnecting…" : `Linking ${institutionName ?? "account"} and pulling history…`);
    try {
      const res = session.relinkItemId
        ? await api.relinked(session.relinkItemId)
        : await api.exchange(publicToken!, institutionName);
      toast.success(`${res.institutionName} connected`, { id: pending });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Linking failed.", { id: pending });
    } finally {
      setLinking(false);
      await reload();
    }
  }

  async function toggleHidden(id: string, hidden: boolean) {
    try {
      await api.setAccountHidden(id, hidden);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the account.");
    }
  }

  const linkButtons = (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" size="sm" disabled={!configured || !!starting || linking} onClick={() => startLink({ mode: "bank" })}>
        {starting === "bank" ? <Loader2Icon className="animate-spin" /> : <BuildingIcon />} Bank or card
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!configured || !!starting || linking}
        onClick={() => startLink({ mode: "investment" })}
      >
        {starting === "investment" ? <Loader2Icon className="animate-spin" /> : <LineChartIcon />} Investments
      </Button>
    </div>
  );

  return (
    <Panel
      id="accounts"
      width="w-[26rem]"
      onClose={onClose}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Link an account"
          title="Link a bank or card"
          disabled={!configured || !!starting || linking}
          onClick={() => startLink({ mode: "bank" })}
        >
          <PlusIcon />
        </Button>
      }
    >
      {link && (
        <PlaidLinkLauncher
          key={link.token}
          token={link.token}
          onSuccess={(publicToken, metadata) => void finishLink(link, publicToken, metadata.institution?.name ?? null)}
          onDone={() => setLink(null)}
        />
      )}

      <div className="flex flex-col gap-5 px-4 pb-4">
        {!configured && <SetupCard problems={snapshot.setup.problems} />}

        {snapshot.items.length === 0 ? (
          configured && (
            <PanelEmpty icon={LandmarkIcon}>
              <p>
                Link a login read-only through Plaid. Pick <strong>Bank or card</strong> for Chase and the like, and{" "}
                <strong>Investments</strong> for Empower, 401(k)s and brokerages.
              </p>
              {linkButtons}
            </PanelEmpty>
          )
        ) : (
          <>
            {snapshot.items.map((item) => {
              const accounts = snapshot.accounts.filter((a) => a.itemId === item.id);
              return (
                <section key={item.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 px-1">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{item.institutionName}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        item.status === "ok"
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
                          : "bg-destructive/12 text-destructive",
                      )}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`${item.institutionName} options`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={syncing} onSelect={() => void sync([item.id])}>
                          <RefreshCwIcon /> Sync this login
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!configured} onSelect={() => void startLink({ itemId: item.id })}>
                          <LandmarkIcon /> Re-authenticate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setPendingRemove(item)}>
                          <Trash2Icon /> Disconnect…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-muted-foreground px-1 text-[11px]" suppressHydrationWarning>
                    Synced {ago(item.lastSyncedAt)} · {item.products.join(", ") || "no products yet"}
                  </p>
                  {item.status !== "ok" && (
                    <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
                      <AlertTriangleIcon className="text-destructive mt-0.5 size-3.5 shrink-0" />
                      <div className="flex-1">
                        <p>{item.errorMessage ?? item.errorCode}</p>
                        {item.status === "login_required" && (
                          <Button size="xs" variant="outline" className="mt-1.5" onClick={() => void startLink({ itemId: item.id })}>
                            Re-authenticate
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <ul className="divide-border/60 border-border/60 divide-y rounded-lg border">
                    {accounts.map((a) => (
                      <li key={a.id} className={cn("group flex items-center gap-2 px-3 py-2", a.hidden && "opacity-50")}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {a.name}
                            {a.mask && <span className="text-muted-foreground ml-1.5 text-xs">••{a.mask}</span>}
                          </span>
                          <span className="text-muted-foreground block truncate text-[11px] capitalize">
                            {a.subtype ?? a.type}
                            {a.isLiability && " · liability"}
                            {a.holdingsCount > 0 && ` · ${a.holdingsCount} holdings`}
                            {a.isLiability && a.creditLimit ? ` · limit ${money(a.creditLimit, { whole: true })}` : ""}
                          </span>
                        </span>
                        <span className={cn("text-sm tabular-nums", a.isLiability && "text-rose-700 dark:text-rose-400")}>
                          {a.currentBalance === null ? "—" : money(a.isLiability ? -a.currentBalance : a.currentBalance)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground"
                          aria-label={a.hidden ? "Include in net worth" : "Hide from net worth"}
                          title={a.hidden ? "Include in net worth" : "Hide from net worth"}
                          onClick={() => void toggleHidden(a.id, !a.hidden)}
                        >
                          {a.hidden ? <EyeOffIcon /> : <EyeIcon />}
                        </Button>
                      </li>
                    ))}
                    {accounts.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">No accounts yet. Try a sync.</li>}
                  </ul>
                </section>
              );
            })}
            <div className="flex flex-col gap-1.5">
              <PanelLabel>Link another login</PanelLabel>
              {linkButtons}
            </div>
          </>
        )}

        {snapshot.runs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <PanelLabel>Sync log</PanelLabel>
            <ul className="flex flex-col gap-0.5 text-[11px]">
              {snapshot.runs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-1" title={r.error ?? undefined}>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      r.status === "ok" && "bg-emerald-500",
                      r.status === "partial" && "bg-amber-500",
                      r.status === "error" && "bg-destructive",
                      r.status === "running" && "bg-muted-foreground animate-pulse",
                    )}
                  />
                  <span className="text-muted-foreground w-24 shrink-0" suppressHydrationWarning>
                    {ago(r.startedAt)}
                  </span>
                  <span className="text-muted-foreground w-14 shrink-0">{r.trigger}</span>
                  <span className="min-w-0 flex-1 truncate tabular-nums">
                    {r.status === "running"
                      ? "running…"
                      : r.error
                        ? r.error
                        : `+${r.added} ~${r.modified} −${r.removed}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-muted-foreground px-1 text-[11px] leading-4">
          Read-only: Mycelium only requests Plaid&apos;s transactions and investments products. It can&apos;t move money.
        </p>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => !o && setPendingRemove(null)}
        title={`Disconnect ${pendingRemove?.institutionName ?? ""}?`}
        description="Plaid revokes access (and stops billing for it). Its accounts, transactions and balance history are deleted from this machine."
        confirmLabel="Disconnect"
        onConfirm={async () => {
          if (!pendingRemove) return;
          try {
            const res = await api.removeItem(pendingRemove.id);
            if (res.warning) toast.warning(res.warning);
            else toast.success(`${pendingRemove.institutionName} disconnected`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not disconnect.");
          }
          await reload();
        }}
      />
    </Panel>
  );
}
