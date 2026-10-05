"use client";

import { useMemo, useState } from "react";
import { LandmarkIcon, TrendingUpIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Panel, PanelEmpty, PanelLabel } from "@/components/workspace/panel";
import { addDays } from "@/lib/dates";
import { money, percentChange } from "@/lib/format";
import { valueOn } from "@/lib/net-worth";
import type { AccountView, Snapshot } from "@/lib/types";
import type { SectionState } from "@/components/workspace/sections";
import { cn } from "@/lib/utils";
import { NetWorthChart } from "./net-worth-chart";

const RANGES = [
  { id: "1M", days: 30 },
  { id: "3M", days: 91 },
  { id: "1Y", days: 365 },
  { id: "All", days: null },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

type Props = { snapshot: Snapshot; section: SectionState; onOpenAccounts: () => void };

export function NetWorthPanel({ snapshot, section, onOpenAccounts }: Props) {
  const [range, setRange] = useState<RangeId>("3M");
  const { series, totals, today } = snapshot;

  const points = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)?.days;
    if (!days) return series;
    const from = addDays(today, -days);
    return series.filter((p) => p.day >= from);
  }, [series, range, today]);

  const deltas = useMemo(() => {
    const now = totals.netWorth;
    const compare = (label: string, day: string) => {
      const then = valueOn(series, day);
      return then === null ? null : { label, change: now - then, pct: percentChange(then, now) };
    };
    // If tracking started this year, YTD compares against the first recorded day.
    const jan1 = `${today.slice(0, 4)}-01-01`;
    const first = series[0]?.day ?? today;
    return [
      compare("1D", addDays(today, -1)),
      compare("30D", addDays(today, -30)),
      compare("YTD", jan1 < first ? first : jan1),
    ].filter((d): d is NonNullable<typeof d> => d !== null);
  }, [series, totals.netWorth, today]);

  const assetGroups = useMemo(
    () => groupByInstitution(snapshot.accounts.filter((a) => !a.isLiability)),
    [snapshot.accounts],
  );
  const liabilityGroups = useMemo(
    () => groupByInstitution(snapshot.accounts.filter((a) => a.isLiability)),
    [snapshot.accounts],
  );

  if (snapshot.accounts.length === 0) {
    return (
      <Panel id="networth" {...section}>
        <PanelEmpty icon={TrendingUpIcon}>
          <p>Link an account to start tracking your net worth. Balances are recorded once a day.</p>
          <Button size="sm" onClick={onOpenAccounts}>
            <LandmarkIcon /> Link accounts
          </Button>
        </PanelEmpty>
      </Panel>
    );
  }

  return (
    <Panel id="networth" {...section}>
      <div className="flex flex-col gap-8 px-6 pt-2 pb-8 sm:px-10">
        {/* Hero: the one number that matters, centered */}
        <div className="flex flex-col items-center gap-1.5 pt-2 text-center">
          <p className="font-heading text-5xl font-semibold tracking-[-0.035em] tabular-nums">
            {money(totals.netWorth)}
          </p>
          <p className="text-muted-foreground text-sm tabular-nums">
            {money(totals.assets, { whole: true })} assets − {money(totals.liabilities, { whole: true })} liabilities
          </p>
          {deltas.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {deltas.map((d) => (
                <span
                  key={d.label}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium tabular-nums",
                    d.change > 0 && "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
                    d.change < 0 && "border-rose-500/30 text-rose-700 dark:text-rose-400",
                    d.change === 0 && "text-muted-foreground border-border",
                  )}
                >
                  <span className="text-muted-foreground">{d.label}</span>
                  {money(d.change, { whole: true, sign: true })}
                  {d.pct && <span className="opacity-70">{d.pct}</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* History */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <PanelLabel>History</PanelLabel>
            <ToggleGroup
              type="single"
              value={range}
              onValueChange={(v) => v && setRange(v as RangeId)}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Range"
            >
              {RANGES.map((r) => (
                <ToggleGroupItem key={r.id} value={r.id} className="h-7 px-2.5 text-xs">
                  {r.id}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="h-72">
            {points.length > 0 ? (
              <NetWorthChart points={points} />
            ) : (
              <p className="text-muted-foreground flex h-full items-center justify-center text-xs">
                No history in this range yet.
              </p>
            )}
          </div>
          {series.length < 3 && (
            <p className="text-muted-foreground text-center text-xs">
              History builds up one point per day as Mycelium syncs. Run{" "}
              <code className="font-mono">npm run launchd:install</code> to record it automatically each morning.
            </p>
          )}
        </div>

        {/* Breakdown: what you own vs. what you owe, side by side */}
        <div className="grid gap-6 md:grid-cols-2">
          <BalanceColumn title="Assets" total={totals.assets} groups={assetGroups} />
          <BalanceColumn title="Liabilities" total={totals.liabilities} groups={liabilityGroups} liability />
        </div>
      </div>
    </Panel>
  );
}

function groupByInstitution(accounts: AccountView[]): [string, AccountView[]][] {
  const map = new Map<string, AccountView[]>();
  for (const a of accounts) {
    const list = map.get(a.institutionName);
    if (list) list.push(a);
    else map.set(a.institutionName, [a]);
  }
  return [...map.entries()];
}

function BalanceColumn({
  title,
  total,
  groups,
  liability = false,
}: {
  title: string;
  total: number;
  groups: [string, AccountView[]][];
  liability?: boolean;
}) {
  return (
    <section className="border-border/60 bg-background/40 flex flex-col gap-4 rounded-xl border p-5">
      <header className="flex items-baseline justify-between">
        <PanelLabel>{title}</PanelLabel>
        <span
          className={cn(
            "text-base font-semibold tabular-nums",
            liability && total > 0 && "text-rose-700 dark:text-rose-400",
          )}
        >
          {money(liability ? -total : total)}
        </span>
      </header>
      {groups.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          {liability ? "Nothing owed." : "No assets yet."}
        </p>
      ) : (
        groups.map(([institution, list]) => (
          <div key={institution} className="flex flex-col gap-1">
            <h4 className="text-muted-foreground text-xs font-medium">{institution}</h4>
            <ul className="divide-border/50 divide-y">
              {list.map((a) => (
                <li key={a.id} className={cn("flex items-center gap-3 py-2 text-sm", a.hidden && "opacity-45")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {a.name}
                      {a.mask && <span className="text-muted-foreground ml-1.5 text-xs">••{a.mask}</span>}
                    </span>
                    <span className="text-muted-foreground block text-[11px] capitalize">
                      {a.subtype ?? a.type}
                      {a.hidden && " · hidden from net worth"}
                    </span>
                  </span>
                  <span className={cn("tabular-nums", liability && "text-rose-700 dark:text-rose-400")}>
                    {a.currentBalance === null ? "—" : money(liability ? -a.currentBalance : a.currentBalance)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
