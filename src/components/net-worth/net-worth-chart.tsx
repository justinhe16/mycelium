"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatDay } from "@/lib/dates";
import { money, moneyCompact } from "@/lib/format";
import type { NetWorthPoint } from "@/lib/net-worth";

type TooltipProps = { active?: boolean; payload?: { payload: NetWorthPoint }[] };

function ChartTooltip({ active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="bg-popover text-popover-foreground border-border rounded-lg border px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground mb-1">
        {formatDay(p.day, { weekday: true, year: true })}
        {!p.recorded && <span className="ml-1 italic">· carried forward</span>}
      </p>
      <p className="text-sm font-semibold tabular-nums">{money(p.netWorth)}</p>
      <p className="text-muted-foreground tabular-nums">
        {money(p.assets, { whole: true })} assets · {money(p.liabilities, { whole: true })} owed
      </p>
    </div>
  );
}

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  const gradientId = useId();
  const values = points.map((p) => p.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.01, 1);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(d: string) => formatDay(d)}
        />
        <YAxis
          width={56}
          tickLine={false}
          axisLine={false}
          domain={[min - pad, max + pad]}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(v: number) => moneyCompact(v)}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
        <Area
          type="monotone"
          dataKey="netWorth"
          stroke="var(--primary)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          dot={points.length === 1 ? { r: 3, fill: "var(--primary)" } : false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
