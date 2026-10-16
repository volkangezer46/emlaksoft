import Link from "@/components/ui/smart-link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { OverflowMenu, SimpleSwap } from "@/components/ui/simple-kit";

/**
 * ViewSwitcher — Liste / Kart / Galeri / Harita anahtarı (URL: ?gorunum=).
 * YALNIZ verilen görünümler çizilir: sayfada karşılığı olmayan görünüm için
 * sahte düğme yoktur. Tek görünüm varsa anahtar hiç çizilmez.
 * Sade modda (plan 2.1) anahtar "Görünüm" (…) menüsüne katlanır: Liste / Pano / Takvim yine bir dokunuşla seçilir,
 * ama araç çubuğunda yer kaplamaz. Sunucu iki düğümü de hazırlar, DOM'a yalnız biri girer.
 */
export type ViewOption = { value: string; label: string; icon: LucideIcon; href: string };

export function ViewSwitcher({
  options,
  active,
  label = "Görünüm",
  className,
}: {
  options: readonly ViewOption[];
  active: string;
  label?: string;
  className?: string;
}) {
  if (options.length < 2) return null;
  const current = options.find((o) => o.value === active) ?? options[0]!;
  const full = (
    <nav
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-canvas p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === active;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={on ? "page" : undefined}
            aria-label={o.label}
            className={cn(
              "focus-ring press inline-flex h-8 touch:h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm font-semibold transition",
              on ? "bg-surface text-brand-700 shadow-[var(--elev-1)]" : "text-text-muted hover:text-text",
            )}
          >
            <o.icon aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">{o.label}</span>
          </Link>
        );
      })}
    </nav>
  );
  const simple = (
    <OverflowMenu label={label} ariaLabel={`${label}: ${current.label}`} className={className}>
      {options.map((o) => (
        <Link key={o.value} href={o.href} aria-current={o.value === active ? "page" : undefined} className="ovf-item focus-ring">
          <o.icon aria-hidden="true" className="h-4 w-4" />
          {o.label}
        </Link>
      ))}
    </OverflowMenu>
  );
  return <SimpleSwap simple={simple} full={full} />;
}
