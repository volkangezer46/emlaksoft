import { FilterChip } from "@/components/ui/filter-chip";
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
  hideAll = false,
  exclude,
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
  /** "Tümü" çipi çizilmez: aynı küme sayfanın KPI süzgeç kartındadır (WP3, tek desen: her süzgeç değeri bir kez). */
  hideAll?: boolean;
  /** Bu değerlerin çipi çizilmez (KPI kartı olarak zaten görünüyor). */
  exclude?: readonly string[];
  className?: string;
}) {
  const built = buildCategoryChips({ options, counts, total, active, pathname, params, paramName, allLabel });
  const chips = built.filter((c) => !(hideAll && c.value === "") && !(exclude && exclude.includes(c.value) && !c.active));
  if (chips.length < (hideAll ? 1 : 2)) return null;
  return (
    // İçerik kolonunun kenarına hizalı (negatif kenar boşluğu yok); dar ekranda yatay kayar.
    <nav aria-label={label} className={cn("strip-fade flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]", className)}>
      {chips.map((c) => (
        <FilterChip
          key={c.value || "all"}
          href={c.href}
          active={c.active}
          count={c.count !== undefined ? formatCount(c.count) : null}
        >
          {c.label}
        </FilterChip>
      ))}
    </nav>
  );
}
