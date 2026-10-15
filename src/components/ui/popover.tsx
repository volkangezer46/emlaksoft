"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Bildirim ve yardımcı paneller için erişilebilir, viewport çarpışmalarını
 * yöneten ortak popover. Escape/dış tıklama, focus yönetimi ve tetikleyiciye
 * dönüş Radix tarafından sağlanır.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = "end",
  sideOffset = 8,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        {...props}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // Kısa ekranda (yatay telefon) panel kullanılabilir yükseklikle sınırlanır ve kendi içinde kayar.
          "popover-in z-[60] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-lg)] outline-none",
          className,
        )}
      />
    </PopoverPrimitive.Portal>
  );
}
