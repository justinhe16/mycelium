"use client";

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PANELS, type PanelId } from "./panels";

type PanelProps = {
  id: PanelId;
  /** Tailwind width class; each panel picks a width that suits its content. */
  width: string;
  /** Extra controls in the panel header (add buttons, filters). */
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Body scrolls by default; the grid manages its own scrolling. */
  scroll?: boolean;
};

/** One column of the workspace: a card filling 80% of the page height (10% air above and below), with a prominent header. */
export function Panel({ id, width, actions, onClose, children, scroll = true }: PanelProps) {
  const { label, icon: Icon } = PANELS[id];
  return (
    <section
      aria-label={label}
      className={cn(
        "bg-card/45 border-border/50 animate-in fade-in slide-in-from-left-2 flex h-[80%] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgb(0_0_0/0.03),0_8px_24px_-12px_rgb(0_0_0/0.08)] duration-200",
        width,
      )}
    >
      {/* Header buttons (this one and any `actions`) render a size larger than usual. */}
      <header className="flex h-16 shrink-0 items-center gap-2.5 pr-3 pl-5 [&_button]:size-8 [&_button_svg]:size-[18px]!">
        <Icon className="text-muted-foreground size-5" aria-hidden />
        <h2 className="text-lg font-semibold tracking-[-0.02em]">{label}</h2>
        <div className="ml-auto flex items-center gap-0.5">
          {actions}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={`Close ${label}`}
            className="text-muted-foreground"
          >
            <XIcon />
          </Button>
        </div>
      </header>
      <div className={cn("min-h-0 flex-1", scroll ? "overflow-y-auto" : "flex flex-col overflow-hidden")}>{children}</div>
    </section>
  );
}

/** Small uppercase label used for groups inside panels. */
export function PanelLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-muted-foreground px-1 text-[11px] font-medium tracking-wide uppercase", className)}>
      {children}
    </h3>
  );
}

export function PanelEmpty({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 px-6 py-14 text-center text-sm">
      <Icon className="size-6 opacity-50" />
      {children}
    </div>
  );
}
