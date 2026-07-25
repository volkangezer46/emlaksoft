"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs — müşteri 360, portföy detay, ayarlar gibi sekmeli ekranlar için.
 *
 * Radix doğru ARIA rollerini (`tablist`/`tab`/`tabpanel`) ve ok tuşlarıyla
 * gezinmeyi kurar; elle yazılan sekmelerde bu ikisi neredeyse her zaman eksik.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      {...props}
      className={cn(
        "inline-flex items-center gap-1 rounded-[12px] border border-line bg-canvas p-1",
        className,
      )}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      {...props}
      className={cn(
        "inline-flex items-center gap-2 rounded-[9px] px-3.5 py-2 text-sm font-semibold text-text-muted outline-none transition",
        "hover:text-ink-950",
        "data-[state=active]:bg-surface data-[state=active]:text-ink-950 data-[state=active]:shadow-[var(--shadow-xs)]",
        "[&_svg]:h-4 [&_svg]:w-4",
        className,
      )}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content {...props} className={cn("mt-4 outline-none", className)} />
  );
}
