"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Select — Radix tabanlı, panel form alanlarıyla birebir aynı görünümde.
 *
 * Native `<select>` üzerindeki kazanımlar: klavye ile harf yazarak arama,
 * tutarlı görünüm (native açılır liste OS'a göre değişmez), uzun listelerde
 * kaydırma okları, seçili öğede tik işareti.
 *
 * ÖNEMLİ — Server Action uyumu: `name` verildiğinde Radix gizli bir native
 * `<select>` render eder, yani mevcut `<form action={submit}>` + `FormData`
 * desenimiz aynen çalışır. Ek bir state yönetimine gerek yok.
 *
 * KAYDIRMA KİLİDİ: Radix Select açıkken body'yi kilitler (react-remove-scroll; kapatılamaz). Form sayfalarında
 * bu beklenen davranış; kabuktaki yapışkan yan menü `console.css` "Yapışkan yan menü güvencesi" ile korunur.
 * Tablo satırı / sayfa içi hızlı seçimde bunun yerine kilitlemeyen `InlineSelect` kullanılır.
 *
 *   <Select name="kind" defaultValue="followup">
 *     <SelectTrigger placeholder="Seçiniz" />
 *     <SelectContent>
 *       <SelectItem value="followup">Takip</SelectItem>
 *     </SelectContent>
 *   </Select>
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  placeholder,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & { placeholder?: string }) {
  return (
    <SelectPrimitive.Trigger
      {...props}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-[0.4375rem] text-left text-sm text-ink-950 outline-none transition touch:min-h-11",
        "focus:border-brand-400 focus:bg-surface data-[state=open]:border-brand-400 data-[state=open]:bg-surface",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "data-[placeholder]:text-text-faint",
        className,
      )}
    >
      {children ?? <SelectPrimitive.Value placeholder={placeholder} />}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-faint" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        {...props}
        position={position}
        className={cn(
          "popover-in z-[60] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
          position === "popper" && "translate-y-1",
          className,
        )}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-text-faint">
          <ChevronUp className="h-4 w-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-text-faint">
          <ChevronDown className="h-4 w-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      {...props}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-[var(--radius-control)] py-2 pl-3 pr-8 text-sm text-ink-950 outline-none transition touch:min-h-11",
        "data-[highlighted]:bg-surface-selected data-[highlighted]:text-brand-700",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5">
        <Check className="h-4 w-4 text-brand-600" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      {...props}
      className={cn("px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint", className)}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator {...props} className={cn("my-1 h-px bg-line", className)} />;
}
