"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** A compact dropdown of checkboxes; the trigger shows how many are picked. */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  groups,
}: {
  label: string;
  options: { value: string; label: string; group?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Render options under group headings, in this order. */
  groups?: string[];
}) {
  const set = new Set(selected);
  const toggle = (v: string, on: boolean) => onChange(on ? [...selected, v] : selected.filter((s) => s !== v));
  const sections = groups ? groups.map((g) => ({ g, opts: options.filter((o) => o.group === g) })) : [{ g: null, opts: options }];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 text-xs", selected.length && "border-primary/50")}>
          {label}
          {selected.length > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] leading-4 tabular-nums">
              {selected.length}
            </span>
          )}
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        {sections.map(({ g, opts }, i) =>
          opts.length === 0 ? null : (
            <div key={g ?? i}>
              {g && <DropdownMenuLabel className="text-muted-foreground text-[11px]">{g}</DropdownMenuLabel>}
              {opts.map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.value}
                  checked={set.has(o.value)}
                  onCheckedChange={(on) => toggle(o.value, on === true)}
                  onSelect={(e) => e.preventDefault()}
                  className="text-xs"
                >
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          ),
        )}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onSelect={() => onChange([])}>
              <XIcon /> Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SingleSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  active,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  active?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1.5 text-xs", active && "border-primary/50")}>
          {label}
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
