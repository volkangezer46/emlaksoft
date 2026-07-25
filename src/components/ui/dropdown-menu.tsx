"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * DropdownMenu — satır işlemleri, "…" menüleri, filtre menüleri için.
 *
 * Elle yazılan menülerde eksik kalan davranışlar burada hazır: ok tuşlarıyla
 * gezinme, Esc/dışarı tıklama ile kapanma, focus'un tetikleyiciye dönmesi,
 * ekran dışına taşmayı önleyen konumlandırma (collision detection).
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        {...props}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "popover-in z-[60] min-w-[11rem] overflow-hidden rounded-[12px] border border-line bg-surface p-1.5 shadow-[var(--shadow-card)]",
          className,
        )}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      {...props}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-3 py-2 text-sm outline-none transition [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
        danger
          ? "text-danger-500 data-[highlighted]:bg-danger-500/[0.08]"
          : "text-ink-950 data-[highlighted]:bg-brand-600/[0.07] data-[highlighted]:text-brand-700",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      {...props}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-[8px] py-2 pl-8 pr-3 text-sm text-ink-950 outline-none transition",
        "data-[highlighted]:bg-brand-600/[0.07] data-[highlighted]:text-brand-700",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      <DropdownMenuPrimitive.ItemIndicator className="absolute left-2.5">
        <Check className="h-4 w-4 text-brand-600" />
      </DropdownMenuPrimitive.ItemIndicator>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      {...props}
      className={cn(
        "px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint",
        className,
      )}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator {...props} className={cn("my-1 h-px bg-line", className)} />
  );
}
