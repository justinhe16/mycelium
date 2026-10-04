import type { LedgerPage, Snapshot } from "@/lib/types";
import type { SyncSummary } from "@/lib/sync";

/** Thrown for any non-2xx response; `message` is the server's `{ error }` string when present. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError("Network error — is the dev server running?", 0);
  }

  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}

const enc = encodeURIComponent;

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

type SyncResult = Extract<SyncSummary, { skipped: false }>;

export const api = {
  snapshot: () => request<Snapshot>("/api/snapshot"),
  ledger: (params: URLSearchParams) => request<LedgerPage>(`/api/ledger?${params}`),

  sync: (itemIds?: string[]) => request<SyncResult>("/api/sync", json("POST", itemIds ? { itemIds } : {})),

  linkToken: (input: { mode: "bank" | "investment" } | { itemId: string }) =>
    request<{ linkToken: string }>("/api/plaid/link-token", json("POST", input)).then((r) => r.linkToken),
  exchange: (publicToken: string, institutionName: string | null) =>
    request<{ itemId: string; institutionName: string; sync: SyncSummary }>(
      "/api/plaid/exchange",
      json("POST", { publicToken, institutionName }),
    ),
  relinked: (itemId: string) =>
    request<{ itemId: string; institutionName: string; sync: SyncSummary }>(
      "/api/plaid/exchange",
      json("POST", { relinkedItemId: itemId }),
    ),

  setAccountHidden: (id: string, hidden: boolean) =>
    request<{ ok: true }>(`/api/accounts/${enc(id)}`, json("PATCH", { hidden })),
  removeItem: (id: string) => request<{ ok: true; warning: string | null }>(`/api/items/${enc(id)}`, { method: "DELETE" }),
};
