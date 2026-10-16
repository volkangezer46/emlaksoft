"use client";

import { useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import type { PortalMenuProps } from "./portal-menu";

/** Portal menü gövdesi (Radix Popover + Portal) — `portal-menu.tsx` tarafından ilk etkileşimde yüklenir. */
export function PortalMenuPanel({ label, trigger, triggerClassName, align = "end", contentClassName, disabled, children, initialOpen }: PortalMenuProps & { initialOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(initialOpen));
  const closeOnPick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a,button")) setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger type="button" disabled={disabled} aria-label={label} title={label} className={triggerClassName}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        collisionPadding={8}
        aria-label={label}
        onClick={closeOnPick}
        className={cn("portal-menu min-w-[12rem] p-1.5", contentClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
