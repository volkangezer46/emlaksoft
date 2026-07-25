"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tooltip — `title=""` yerine. Fark: klavye ile focus'ta da açılır, dokunmatik
 * cihazlarda kilitlenmez ve ekran dışına taşmaz.
 *
 * Basit kullanım için `<Tip label="…">` yeterli; Provider'ı kendi içinde kurar.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        {...props}
        sideOffset={sideOffset}
        className={cn(
          "popover-in z-[70] max-w-xs rounded-[9px] bg-ink-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-[var(--shadow-card)]",
          className,
        )}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Tek satırlık kullanım: <Tip label="Lead skoru">{children}</Tip> */
export function Tip({
  label,
  children,
  side = "top",
  delay = 200,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
