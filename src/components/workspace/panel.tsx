"use client";

import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { SECTIONS, type SectionId, type SectionState } from "./sections";

type SectionProps = SectionState & {
  id: SectionId;
  /** Extra controls in the header (shown only while open). */
  actions?: React.ReactNode;
  /** Classes for the body, e.g. a fixed height for the ledger's scrolling table. */
  bodyClassName?: string;
  children: React.ReactNode;
};

/**
 * One collapsible section of the page. The body stays mounted while collapsed
 * (just hidden) so filters and scroll positions survive a collapse.
 */
export function Panel({ id, open, onToggle, summary, actions, bodyClassName, children }: SectionProps) {
  const { label, icon: Icon } = SECTIONS[id];
  const bodyId = `section-${id}`;
  return (
    <section
      id={id}
      aria-label={label}
      className="bg-card/45 border-border/50 flex w-full scroll-mt-4 flex-col overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgb(0_0_0/0.03),0_8px_24px_-12px_rgb(0_0_0/0.08)]"
    >
      <header className="flex h-14 shrink-0 items-center gap-1 pr-3 pl-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="hover:bg-muted/50 focus-visible:ring-ring/50 flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 text-left outline-none focus-visible:ring-[3px]"
        >
          <ChevronDownIcon
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform duration-200",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden />
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{label}</h2>
          {summary !== undefined && (
            <span className="text-muted-foreground ml-1 truncate text-sm tabular-nums">{summary}</span>
          )}
        </button>
        {open && actions && (
          <div className="flex items-center gap-0.5 [&_button]:size-8 [&_button_svg]:size-[18px]!">{actions}</div>
        )}
      </header>
      <div id={bodyId} hidden={!open} className={cn(open && bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Small uppercase label used for groups inside sections. */
export function PanelLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-muted-foreground px-1 text-[11px] font-medium tracking-wide uppercase", className)}>
      {children}
    </h3>
  );
}

export function PanelEmpty({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 px-6 py-12 text-center text-sm">
      <Icon className="size-6 opacity-50" />
      {children}
    </div>
  );
}
