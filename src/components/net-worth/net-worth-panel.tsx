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

  const groups = useMemo(() => {
    const map = new Map<string, AccountView[]>();
    for (const a of snapshot.accounts) {
      const list = map.get(a.institutionName);
      if (list) list.push(a);
      else map.set(a.institutionName, [a]);
    }
    return [...map.entries()];
  }, [snapshot.accounts]);

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
      <div className="flex flex-col gap-6 px-5 pb-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(16rem,1fr)_2fr]">
          <div className="flex flex-col gap-1 lg:pt-6">
            <p className="font-heading text-4xl font-semibold tracking-[-0.03em] tabular-nums">
              {money(totals.netWorth)}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {money(totals.assets, { whole: true })} assets − {money(totals.liabilities, { whole: true })} liabilities
            </p>
            {deltas.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {deltas.map((d) => (
                  <span
                    key={d.label}
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium tabular-nums",
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

          <div className="flex flex-col gap-2">
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
                  <ToggleGroupItem key={r.id} value={r.id} className="h-6 px-2 text-[11px]">
                    {r.id}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="h-64">
              {points.length > 0 ? (
                <NetWorthChart points={points} />
              ) : (
                <p className="text-muted-foreground flex h-full items-center justify-center text-xs">
                  No history in this range yet.
                </p>
              )}
            </div>
            {series.length < 3 && (
              <p className="text-muted-foreground text-[11px]">
                History builds up one point per day as Mycelium syncs. Run{" "}
                <code className="font-mono">npm run launchd:install</code> to record it automatically each morning.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <PanelLabel>Breakdown</PanelLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(([institution, list]) => (
              <section key={institution} className="flex flex-col">
                <h4 className="text-foreground/80 px-1 pb-1 text-xs font-medium">{institution}</h4>
                <ul className="divide-border/60 border-border/60 divide-y rounded-lg border">
                  {list.map((a) => (
                    <li
                      key={a.id}
                      className={cn("flex items-center gap-3 px-3 py-2 text-sm", a.hidden && "opacity-45")}
                    >
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
                      <span className={cn("tabular-nums", a.isLiability && "text-rose-700 dark:text-rose-400")}>
                        {a.currentBalance === null ? "—" : money(a.isLiability ? -a.currentBalance : a.currentBalance)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
