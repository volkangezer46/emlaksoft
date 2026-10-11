import Link from "@/components/ui/smart-link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * FilterChip — kategori/sekme/durum çipi (TEK reçete; sayfalar kendi çip sınıfını yazmaz).
 *
 * Seçili: lacivert dolgu; seçili değil: ince kenarlı. Dokunmatikte/dar ekranda 44px (`touch:min-h-11`; a11y.css bunu
 * kök yazı boyutundan bağımsız piksele sabitler), odak halkası ve basma geri bildirimi tabandan gelir.
 *  - `href` verilirse bağlantıdır (sunucu filtresi: değer URL'de); seçili çipe `aria-current="page"` otomatik verilir.
 *  - `href` yoksa düğmedir (istemci durumu); seçili çipe `aria-pressed` verilir.
 * Çipe tıklanabilir ikinci öğe (sayaç vb.) KOYMA; sayaç için `count` kullan.
 */
export function filterChipClass({ active = false, className }: { active?: boolean; className?: string } = {}) {
  return cn(
    "focus-ring press inline-flex min-h-8 touch:min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
    active
      ? "border-ink-950 bg-ink-950 text-white"
      : "border-line bg-surface text-ink-950 hover:bg-surface-hover",
    className,
  );
}

type LinkChipProps = { active?: boolean; count?: number | string | null } & ComponentProps<typeof Link>;
type ButtonChipProps = { active?: boolean; count?: number | string | null; href?: undefined } & ComponentProps<"button">;

function Count({ value, active }: { value: number | string | null | undefined; active: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <span className={cn("num rounded-full px-1.5 text-[11px] leading-5", active ? "bg-white/20" : "bg-surface-sunken text-text-muted")}>
      {value}
    </span>
  );
}

export function FilterChip(props: LinkChipProps | ButtonChipProps) {
  if ("href" in props && props.href !== undefined) {
    const { active = false, count, className, children, ...rest } = props as LinkChipProps;
    return (
      <Link aria-current={active ? "page" : undefined} className={filterChipClass({ active, className })} {...rest}>
        {children}
        <Count value={count} active={active} />
      </Link>
    );
  }
  const { active = false, count, className, children, type = "button", ...rest } = props as ButtonChipProps;
  return (
    <button type={type} aria-pressed={active} className={filterChipClass({ active, className })} {...rest}>
      {children}
      <Count value={count} active={active} />
    </button>
  );
}
