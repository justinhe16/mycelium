"use client";

import { cn } from "@/lib/utils";
import { PANEL_IDS, PANELS, type PanelId } from "./panels";

type RailProps = {
  open: readonly PanelId[];
  onToggle: (id: PanelId) => void;
  /** Small right-aligned hint per tab (a total or a count). */
  badges: Partial<Record<PanelId, React.ReactNode>>;
  /** Rendered under the switcher (sync status). */
  footer?: React.ReactNode;
};

/** The floating switcher. Each tab toggles its column on or off. */
export function Rail({ open, onToggle, badges, footer }: RailProps) {
  const alone = open.length === 0;

  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <nav
        aria-label="Panels"
        className="bg-card/85 border-border/70 supports-[backdrop-filter]:bg-card/70 flex w-48 flex-col gap-0.5 rounded-2xl border p-1.5 shadow-lg backdrop-blur-md"
      >
        {PANEL_IDS.map((id) => {
          const { label, icon: Icon, shortcut } = PANELS[id];
          const active = open.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              aria-pressed={active}
              title={`${active ? "Close" : "Open"} ${label} (${shortcut})`}
              className={cn(
                "group/tab relative flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium transition-colors outline-none",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "bg-primary absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon className={cn("size-4 shrink-0", active ? "opacity-90" : "opacity-60")} aria-hidden />
              <span className="flex-1">{label}</span>
              {badges[id] !== undefined && (
                <span className="text-muted-foreground text-[11px] tabular-nums">{badges[id]}</span>
              )}
            </button>
          );
        })}
      </nav>
      {footer}
      {alone && (
        <p className="text-muted-foreground animate-in fade-in text-center text-xs duration-500">
          Open a panel, or press <kbd className="font-mono">1</kbd>–<kbd className="font-mono">3</kbd>.
        </p>
      )}
    </div>
  );
}
