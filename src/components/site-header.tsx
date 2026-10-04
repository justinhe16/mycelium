import Link from "next/link";
import { SproutIcon } from "lucide-react";

import { SettingsMenu } from "@/components/settings-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="site-header bg-background/95 text-foreground border-border/60 supports-[backdrop-filter]:bg-background/88 sticky top-0 z-30 border-b backdrop-blur-md">
      <div className="flex h-13 w-full items-center gap-2.5 px-4 sm:px-6">
        <Link
          href="/"
          className="focus-visible:ring-ring/50 flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px]"
        >
          <SproutIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="font-heading hidden text-[13px] font-semibold tracking-[-0.018em] min-[420px]:inline">
            Mycelium
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeToggle />
          <SettingsMenu />
        </div>
      </div>
    </header>
  );
}
