import Link from "@/components/ui/smart-link";
import { formatCount, type ParamRecord } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";
import { buildCategoryChips, type CategoryOption } from "./list-logic";

/**
 * CategoryChips — sayaçlı kategori sekme çipleri ("Tümü 2.486 · Konut 1.245 …").
 * Sunucu filtresidir: her çip bir link, değer URL'de (`?kategori=` veya `paramName`),
 * sayfa sunucu sorgusunda uygular. Mevcut diğer filtreleri korur, sayfalamayı sıfırlar.
 * `counts` yalnız GERÇEK sayımlarla verilir; güvenilir sayım yoksa `null` geç (sayı çizilmez).
 * Mobilde yatay kayar (sayfa taşmaz).
 */
export function CategoryChips({
  options,
  counts,
  total,
  active,
  pathname,
  params,
  paramName = "kategori",
  label = "Kategori",
  allLabel,
  className,
}: {
  options: readonly CategoryOption[];
  counts: Readonly<Record<string, number>> | null;
  total: number | null;
  active: string;
  pathname: string;
  params: ParamRecord;
  paramName?: string;
  label?: string;
  /** "Tümü" çipinin etiketi (varsayılan "Tümü"). */
  allLabel?: string;
  className?: string;
}) {
  const chips = buildCategoryChips({ options, counts, total, active, pathname, params, paramName, allLabel });
  if (chips.length < 2) return null;
  return (
    <nav aria-label={label} className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]", className)}>
      {chips.map((c) => (
        <Link
          key={c.value || "all"}
          href={c.href}
          aria-current={c.active ? "page" : undefined}
          className={cn(
            "focus-ring press inline-flex min-h-9 touch:min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition",
            c.active
              ? "bg-surface-selected text-brand-700 ring-1 ring-inset ring-brand-600/25"
              : "text-text-muted hover:bg-surface-hover hover:text-text active:bg-surface-pressed",
          )}
        >
          {c.label}
          {c.count !== undefined ? (
            <span
              className={cn(
                "numeric rounded-full px-1.5 text-xs font-semibold",
                c.active ? "bg-brand-600/15 text-brand-700" : "bg-canvas text-text-faint",
              )}
            >
              {formatCount(c.count)}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
