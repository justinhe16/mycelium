import { LandmarkIcon, ScrollTextIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";

/** Top to bottom. Every section is always on the page; each can be collapsed. */
export const SECTION_IDS = ["networth", "ledger", "accounts"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTIONS: Record<SectionId, { label: string; icon: LucideIcon }> = {
  networth: { label: "Net Worth", icon: TrendingUpIcon },
  ledger: { label: "Ledger", icon: ScrollTextIcon },
  accounts: { label: "Accounts", icon: LandmarkIcon },
};

/** Which sections are collapsed lives in a cookie so the server renders the same page (no flash). */
export const COLLAPSED_COOKIE = "mycelium-collapsed";

export function parseCollapsed(raw: string | undefined): SectionId[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(","));
  return SECTION_IDS.filter((id) => wanted.has(id));
}

export function serializeCollapsed(collapsed: readonly SectionId[]): string {
  return SECTION_IDS.filter((id) => collapsed.includes(id)).join(",");
}

/** What each section passes to <Section>: open state, its toggle, and a one-line summary for the header. */
export type SectionState = { open: boolean; onToggle: () => void; summary?: React.ReactNode };
