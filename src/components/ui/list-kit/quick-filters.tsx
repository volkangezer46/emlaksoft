import type { ReactNode } from "react";
import { Zap } from "lucide-react";
import { FilterChip } from "@/components/ui/filter-chip";
import { formatCount } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";

/**
 * QuickFilters — tek dokunuşla iş süzgeci şeridi ("Fiyatı güncellenmeli 25", "Teyit bekliyor 3"; karşılaştırma raporu
 * İŞLEYİŞ). Her çip bir bağlantıdır (sunucu süzgeci, değer URL'de); etkin çipe tekrar dokunmak süzgeci kaldırır
 * (`href` çağıranın kurduğu temizleme adresidir). Sıfır çıkmaz metrik: sayısı 0 olan ve etkin olmayan çip çizilmez;
 * hiç çip kalmazsa şerit yok. Sunucu bileşeni (istemci JS yok).
 */
export type QuickFilterItem = {
  key: string;
  label: string;
  count: number | null;
  href: string;
  active?: boolean;
  /** "danger": dikkat isteyen iş (ör. fiyatı güncellenmeli). */
  tone?: "default" | "danger";
  icon?: ReactNode;
  /** Fare üstü açıklaması (kümenin tanımı). */
  title?: string;
};

export function quickFilterVisible(items: readonly QuickFilterItem[]): QuickFilterItem[] {
  return items.filter((it) => it.active || (it.count ?? 0) > 0);
}

export function QuickFilters({ items, label = "Hızlı süzgeçler", className }: { items: readonly QuickFilterItem[]; label?: string; className?: string }) {
  const shown = quickFilterVisible(items);
  if (shown.length === 0) return null;
  return (
    <nav aria-label={label} className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {/* Yalnız simge (yer kazanır; şerit tip çipleriyle aynı satıra sığar); anlamı `aria-label` ve `title` taşır. */}
      <span className="inline-grid shrink-0 place-items-center text-brand-600" title={label} aria-hidden="true">
        <Zap className="h-4 w-4" />
      </span>
      {shown.map((it) => (
        <FilterChip
          key={it.key}
          href={it.href}
          active={it.active}
          tone={it.tone === "danger" ? "danger" : undefined}
          count={it.count != null ? formatCount(it.count) : null}
          title={it.title ?? (it.active ? "Süzgeç etkin — kaldırmak için dokunun" : undefined)}
        >
          {it.icon}
          {it.label}
        </FilterChip>
      ))}
    </nav>
  );
}
