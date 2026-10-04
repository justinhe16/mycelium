import { KINDS, type Kind } from "./classify";
import { isIsoDay } from "./dates";

/*
 * Ledger filters <-> URL search params. Client-safe (no DB imports), so the
 * Ledger panel keeps its state in the URL and the API parses the same shape.
 */

export const SORT_KEYS = ["date", "amount", "description", "account", "category", "kind"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const PENDING_MODES = ["include", "exclude", "only"] as const;
export type PendingMode = (typeof PENDING_MODES)[number];

export type LedgerQuery = {
  accounts: string[];
  kinds: Kind[];
  categories: string[];
  from: string | null;
  to: string | null;
  q: string;
  pending: PendingMode;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

export const DEFAULT_QUERY: LedgerQuery = {
  accounts: [],
  kinds: [],
  categories: [],
  from: null,
  to: null,
  q: "",
  pending: "include",
  sort: "date",
  dir: "desc",
  page: 1,
  pageSize: 100,
};

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export function parseLedgerQuery(params: URLSearchParams): LedgerQuery {
  const sort = params.get("sort");
  const pending = params.get("pending");
  const from = params.get("from");
  const to = params.get("to");
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    accounts: list(params.get("accounts")),
    kinds: list(params.get("kinds")).filter((k): k is Kind => (KINDS as readonly string[]).includes(k)),
    categories: list(params.get("categories")),
    from: from && isIsoDay(from) ? from : null,
    to: to && isIsoDay(to) ? to : null,
    q: (params.get("q") ?? "").trim().slice(0, 200),
    pending: (PENDING_MODES as readonly string[]).includes(pending ?? "") ? (pending as PendingMode) : "include",
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : "date",
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 500) : DEFAULT_QUERY.pageSize,
  };
}

/** Only non-default values, so URLs stay short. */
export function serializeLedgerQuery(q: LedgerQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.accounts.length) p.set("accounts", q.accounts.join(","));
  if (q.kinds.length) p.set("kinds", q.kinds.join(","));
  if (q.categories.length) p.set("categories", q.categories.join(","));
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.q) p.set("q", q.q);
  if (q.pending !== DEFAULT_QUERY.pending) p.set("pending", q.pending);
  if (q.sort !== DEFAULT_QUERY.sort) p.set("sort", q.sort);
  if (q.dir !== DEFAULT_QUERY.dir) p.set("dir", q.dir);
  if (q.page !== 1) p.set("page", String(q.page));
  if (q.pageSize !== DEFAULT_QUERY.pageSize) p.set("pageSize", String(q.pageSize));
  return p;
}
