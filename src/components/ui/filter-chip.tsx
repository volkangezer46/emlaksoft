import Link from "@/components/ui/smart-link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * FilterChip — kategori/sekme/durum çipi (tek reçete).
 *
 * Seçili: lacivert dolgu; seçili değil: ince kenarlı. Dokunmatikte 44px (`touch:min-h-11`),
 * odak halkası ve basma geri bildirimi tabandan gelir. Bağlantıdır (sunucu filtresi: değer URL'de);
 * seçili çipe `aria-current="page"` otomatik verilir.
 */
export function filterChipClass({ active = false, className }: { active?: boolean; className?: string } = {}) {
  return cn(
    "focus-ring press inline-flex min-h-8 touch:min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
    active
      ? "border-ink-950 bg-ink-950 text-white"
      : "border-line bg-surface text-ink-950 hover:bg-surface-hover",
    className,
  );
}

export function FilterChip({
  active = false,
  className,
  ...props
}: { active?: boolean } & ComponentProps<typeof Link>) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={filterChipClass({ active, className })}
      {...props}
    />
  );
}
