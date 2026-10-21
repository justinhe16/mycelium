"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ScrollTextIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelEmpty } from "@/components/workspace/panel";
import { api } from "@/lib/api-client";
import { categoryLabel, KINDS, type Kind, type TransferTag } from "@/lib/classify";
import { addDays, formatDay } from "@/lib/dates";
import { money } from "@/lib/format";
import {
  DEFAULT_QUERY,
  parseLedgerQuery,
  serializeLedgerQuery,
  type LedgerQuery,
  type PendingMode,
  type SortKey,
} from "@/lib/ledger-query";
import type { LedgerPage, Snapshot } from "@/lib/types";
import type { SectionState } from "@/components/workspace/sections";
import { cn } from "@/lib/utils";
import { MultiSelect, SingleSelect } from "./filters";

export const KIND_STYLES: Record<Kind, string> = {
  income: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  spend: "bg-muted text-muted-foreground",
  refund: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  transfer: "bg-violet-500/12 text-violet-700 dark:text-violet-400",
};

const KIND_LABELS: Record<Kind, string> = { income: "Income", spend: "Spend", refund: "Refund", transfer: "Transfer" };

/** What a transfer pill says, by tag. */
const TRANSFER_TAG_LABELS: Record<TransferTag, string> = {
  card_payment: "Card payment",
  invest: "Investing",
  internal: "Transfer",
};

const PENDING_OPTIONS: { value: PendingMode; label: string }[] = [
  { value: "include", label: "Posted + pending" },
  { value: "exclude", label: "Posted only" },
  { value: "only", label: "Pending only" },
];

type DatePreset = "all" | "30d" | "90d" | "month" | "lastMonth" | "ytd" | "lastYear" | "custom";

function presetRange(preset: DatePreset, today: string): { from: string | null; to: string | null } {
  const y = Number(today.slice(0, 4));
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "30d":
      return { from: addDays(today, -29), to: null };
    case "90d":
      return { from: addDays(today, -89), to: null };
    case "month":
      return { from: monthStart, to: null };
    case "lastMonth": {
      const lastEnd = addDays(monthStart, -1);
      return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
    }
    case "ytd":
      return { from: `${y}-01-01`, to: null };
    case "lastYear":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: null, to: null };
  }
}

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "ytd", label: "Year to date" },
  { value: "lastYear", label: "Last year" },
];

function detectPreset(q: LedgerQuery, today: string): DatePreset {
  for (const p of PRESETS) {
    const r = presetRange(p.value, today);
    if (r.from === q.from && r.to === q.to) return p.value;
  }
  return "custom";
}

type Props = { snapshot: Snapshot; version: number; initialParams: string; section: SectionState };

export function LedgerPanel({ snapshot, version, initialParams, section }: Props) {
  const [query, setQueryState] = useState<LedgerQuery>(() => parseLedgerQuery(new URLSearchParams(initialParams)));
  const [search, setSearch] = useState(query.q);
  const [result, setResult] = useState<{ key: string; page: LedgerPage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const params = useMemo(() => serializeLedgerQuery(query), [query]);
  const key = `${params}#${version}`;
  const loading = result?.key !== key;

  // Updater stays pure: Strict Mode may run it twice, and it runs during render.
  function setQuery(patch: Partial<LedgerQuery>, keepPage = false) {
    setQueryState((prev) => ({ ...prev, ...patch, page: keepPage ? (patch.page ?? prev.page) : 1 }));
  }

  // Filters live in the URL, so a reload or a bookmark lands on the same view. Synced after
  // commit, since Next's router observes history.replaceState and must not update mid-render.
  useEffect(() => {
    const qs = params.toString();
    const target = qs ? `/?${qs}` : "/";
    if (window.location.pathname + window.location.search !== target) window.history.replaceState(null, "", target);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    api
      .ledger(params)
      .then((page) => {
        if (cancelled) return;
        setResult({ key, page });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the ledger.");
      });
    return () => {
      cancelled = true;
    };
  }, [params, key]);

  const accountOptions = snapshot.accounts.map((a) => ({
    value: a.id,
    label: `${a.name}${a.mask ? ` ••${a.mask}` : ""}`,
    group: a.institutionName,
  }));
  const institutions = [...new Set(snapshot.accounts.map((a) => a.institutionName))];
  const categoryOptions = snapshot.categories.map((c) => ({ value: c, label: categoryLabel(c) }));

  const preset = detectPreset(query, snapshot.today);
  const filtersActive =
    query.accounts.length + query.kinds.length + query.categories.length > 0 ||
    query.from !== null ||
    query.to !== null ||
    query.q !== "" ||
    query.pending !== "include";

  const page = result?.page;
  const pages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  function sortBy(col: SortKey) {
    if (query.sort === col) setQuery({ dir: query.dir === "asc" ? "desc" : "asc" });
    else
      setQuery({
        sort: col,
        dir: col === "description" || col === "account" || col === "category" || col === "kind" ? "asc" : "desc",
      });
  }

  if (snapshot.transactionCount === 0) {
    return (
      <Panel id="ledger" {...section}>
        <PanelEmpty icon={ScrollTextIcon}>
          <p>Every transaction from every linked account lands here after a sync.</p>
        </PanelEmpty>
      </Panel>
    );
  }

  return (
    <Panel
      id="ledger"
      {...section}
      bodyClassName="flex h-[75vh] min-h-[28rem] flex-col"
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          asChild
          aria-label="Download filtered ledger as CSV"
          title="Download CSV"
        >
          <a href={`/api/ledger?${new URLSearchParams([...params, ["format", "csv"]])}`} download>
            <DownloadIcon />
          </a>
        </Button>
      }
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => {
              const v = e.target.value;
              setSearch(v);
              clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => setQuery({ q: v.trim() }), 250);
            }}
            placeholder="Search merchant or description"
            className="h-8 w-60 pl-8 text-xs"
            aria-label="Search transactions"
          />
        </div>
        <MultiSelect
          label="Account"
          options={accountOptions}
          groups={institutions}
          selected={query.accounts}
          onChange={(accounts) => setQuery({ accounts })}
        />
        <MultiSelect
          label="Type"
          options={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          selected={query.kinds}
          onChange={(kinds) => setQuery({ kinds: kinds as Kind[] })}
        />
        <MultiSelect
          label="Category"
          options={categoryOptions}
          selected={query.categories}
          onChange={(categories) => setQuery({ categories })}
        />
        <SingleSelect
          label={preset === "custom" ? "Custom dates" : PRESETS.find((p) => p.value === preset)!.label}
          value={preset}
          options={preset === "custom" ? [...PRESETS, { value: "custom", label: "Custom dates" }] : PRESETS}
          onChange={(p) => p !== "custom" && setQuery(presetRange(p, snapshot.today))}
          active={preset !== "all"}
        />
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={query.from ?? ""}
            max={query.to ?? undefined}
            onChange={(e) => setQuery({ from: e.target.value || null })}
            className="h-8 w-[8.5rem] text-xs"
            aria-label="From date"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="date"
            value={query.to ?? ""}
            min={query.from ?? undefined}
            onChange={(e) => setQuery({ to: e.target.value || null })}
            className="h-8 w-[8.5rem] text-xs"
            aria-label="To date"
          />
        </div>
        <SingleSelect
          label={PENDING_OPTIONS.find((o) => o.value === query.pending)!.label}
          value={query.pending}
          options={PENDING_OPTIONS}
          onChange={(pending) => setQuery({ pending })}
          active={query.pending !== "include"}
        />
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-8 text-xs"
            onClick={() => {
              setSearch("");
              setQuery({ ...DEFAULT_QUERY, sort: query.sort, dir: query.dir, pageSize: query.pageSize });
            }}
          >
            <XIcon /> Reset
          </Button>
        )}
      </div>

      {/* Totals for everything matching the filters (not just this page) */}
      <div className="border-border/60 text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 border-y px-5 py-2 text-xs tabular-nums">
        <span>
          <span className="text-foreground font-medium">{page ? page.total.toLocaleString() : "…"}</span> transactions
        </span>
        {page && (
          <>
            <span>
              In <span className="text-emerald-700 dark:text-emerald-400">{money(page.inflow)}</span>
            </span>
            <span>
              Out <span className="text-rose-700 dark:text-rose-400">{money(page.outflow)}</span>
            </span>
            <span>
              Net{" "}
              <span className="text-foreground font-medium">{money(page.inflow - page.outflow, { sign: true })}</span>
            </span>
          </>
        )}
        {page && page.transfers.moved + Math.abs(page.transfers.invested) + page.transfers.unmatched.count > 0 && (
          <span
            className="ml-auto"
            title="Money moved between your own accounts, counted once on the sending side. Not part of In or Out."
          >
            Transfers <span className="text-violet-700 dark:text-violet-400">{money(page.transfers.moved)}</span>
            <span className="text-[11px]"> (moved between your accounts)</span>
            {page.transfers.invested !== 0 && <> · invested {money(page.transfers.invested)}</>}
            {page.transfers.cardPayments > 0 && <> · card payments {money(page.transfers.cardPayments)}</>}
            {page.transfers.unmatched.count > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}
                · {page.transfers.unmatched.count} to a card not linked ({money(page.transfers.unmatched.total)})
              </span>
            )}
          </span>
        )}
      </div>

      {error && <p className="text-destructive px-5 py-3 text-xs">{error}</p>}

      {/* Table */}
      <div className={cn("min-h-0 flex-1 overflow-auto transition-opacity", loading && "opacity-60")}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col className="w-[6.5rem]" />
            <col />
            <col className="w-[13rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[10rem]" />
            <col className="w-[8rem]" />
          </colgroup>
          <thead className="bg-card sticky top-0 z-10">
            <tr className="text-muted-foreground text-left text-[11px] font-medium tracking-wide uppercase">
              {(
                [
                  ["date", "Date"],
                  ["description", "Description"],
                  ["account", "Account"],
                  ["kind", "Type"],
                  ["category", "Category"],
                  ["amount", "Amount"],
                ] as [SortKey, string][]
              ).map(([col, label]) => (
                <th
                  key={col}
                  aria-sort={query.sort === col ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(
                    "border-border/60 border-b px-3 py-2 first:pl-5 last:pr-5",
                    col === "amount" && "text-right",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(col)}
                    className={cn(
                      "hover:text-foreground inline-flex items-center gap-1 uppercase",
                      query.sort === col && "text-foreground",
                    )}
                  >
                    {label}
                    {query.sort === col &&
                      (query.dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-muted/40 group", r.pending && "text-muted-foreground")}>
                <td className="border-border/40 border-b px-3 py-2 pl-5 text-xs whitespace-nowrap tabular-nums">
                  {formatDay(r.date, { year: r.date.slice(0, 4) !== snapshot.today.slice(0, 4) })}
                </td>
                <td className="border-border/40 border-b px-3 py-2">
                  <span className="block truncate" title={r.rawName}>
                    {r.description}
                    {r.pending && (
                      <span className="border-border ml-2 rounded border px-1 py-px text-[10px] font-medium uppercase">
                        pending
                      </span>
                    )}
                    {r.unmatched && (
                      <span
                        className="ml-2 rounded border border-amber-500/40 px-1 py-px text-[10px] font-medium text-amber-700 uppercase dark:text-amber-400"
                        title="No matching payment arrived on a linked card or loan. Link that card to pair it."
                      >
                        card not linked
                      </span>
                    )}
                  </span>
                  {r.description !== r.rawName && (
                    <span className="text-muted-foreground block truncate text-[11px]">{r.rawName}</span>
                  )}
                </td>
                <td className="border-border/40 border-b px-3 py-2">
                  <span className="block truncate text-xs">
                    {r.accountName}
                    {r.accountMask && <span className="text-muted-foreground"> ••{r.accountMask}</span>}
                  </span>
                  <span className="text-muted-foreground block truncate text-[11px]">{r.institution}</span>
                </td>
                <td className="border-border/40 border-b px-3 py-2">
                  <span
                    className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", KIND_STYLES[r.kind])}
                  >
                    {r.kind === "transfer" && r.transferTag ? TRANSFER_TAG_LABELS[r.transferTag] : KIND_LABELS[r.kind]}
                  </span>
                </td>
                <td className="border-border/40 border-b px-3 py-2">
                  <span
                    className="block truncate text-xs"
                    title={r.categoryDetailed ? categoryLabel(r.categoryDetailed) : undefined}
                  >
                    {categoryLabel(r.categoryPrimary)}
                  </span>
                </td>
                <td
                  className={cn(
                    "border-border/40 border-b px-3 py-2 pr-5 text-right whitespace-nowrap tabular-nums",
                    r.amount > 0 && r.kind !== "transfer" && "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {money(r.amount, { sign: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page && page.rows.length === 0 && (
          <p className="text-muted-foreground px-5 py-10 text-center text-sm">No transactions match these filters.</p>
        )}
      </div>

      {/* Paging */}
      {page && page.total > 0 && (
        <div className="border-border/60 text-muted-foreground flex items-center gap-2 border-t px-5 py-2 text-xs tabular-nums">
          <span>
            {((page.page - 1) * page.pageSize + 1).toLocaleString()}–
            {Math.min(page.page * page.pageSize, page.total).toLocaleString()} of {page.total.toLocaleString()}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={query.page <= 1}
              onClick={() => setQuery({ page: query.page - 1 }, true)}
            >
              <ChevronLeftIcon />
            </Button>
            <span>
              Page {query.page} of {pages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={query.page >= pages}
              onClick={() => setQuery({ page: query.page + 1 }, true)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
