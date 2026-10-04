import { LandmarkIcon, ScrollTextIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";

/** Display order, left to right. */
export const PANEL_IDS = ["networth", "ledger", "accounts"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PANELS: Record<PanelId, { label: string; icon: LucideIcon; shortcut: string }> = {
  networth: { label: "Net Worth", icon: TrendingUpIcon, shortcut: "1" },
  ledger: { label: "Ledger", icon: ScrollTextIcon, shortcut: "2" },
  accounts: { label: "Accounts", icon: LandmarkIcon, shortcut: "3" },
};

/** Which panels are open is kept in a cookie so the server renders the same layout (no flash). */
export const PANELS_COOKIE = "mycelium-panels";
export const DEFAULT_PANELS: PanelId[] = ["networth", "ledger"];

export function parsePanels(raw: string | undefined): PanelId[] {
  if (raw === undefined) return DEFAULT_PANELS;
  const wanted = new Set(raw.split(","));
  return PANEL_IDS.filter((id) => wanted.has(id));
}

export function serializePanels(open: readonly PanelId[]): string {
  return PANEL_IDS.filter((id) => open.includes(id)).join(",");
}
