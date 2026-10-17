import type { ComponentType } from "react";
import Link from "@/components/ui/smart-link";
import { MorphNavMore } from "@/components/ui/morph-nav-more";
import { MorphNavScrollActive } from "@/components/ui/morph-nav-scroll";
import { cn } from "@/lib/utils";

export type SegmentTabItem = {
  id: string;
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Sayaç rozeti; null/undefined ise gösterilmez. */
  count?: number | null;
};

/** Telefonda (<640 px) şeritte görünen en çok sekme; kalanı "Tümü +N" menüsündedir (hub şeridiyle aynı desen). */
export const SEGMENT_TABS_PHONE = 3;

/** Telefonda görünür sekmelerin dizinleri: ilk sekmeler, etkin sekme her zaman dahil. */
export function segmentPhoneVisible(ids: readonly string[], active: string, max = SEGMENT_TABS_PHONE): Set<number> {
  if (ids.length <= max) return new Set(ids.map((_, i) => i));
  const activeIdx = ids.indexOf(active);
  const head = activeIdx >= max - 1 ? max - 1 : max;
  const out = new Set(Array.from({ length: head }, (_, i) => i));
  if (activeIdx >= 0) out.add(activeIdx);
  return out;
}

/**
 * Sayfanın KENDİ iç sekmeleri (sunucu bileşeni; durum URL'de, `?sekme=`). Hub sekme şeridinin (section-tabs) altında
 * ikinci bir kapsüllü şerit yerine ALT ÇİZGİLİ, daha küçük sekmelerdir: süzgeç çiplerine (dolgulu kapsül) benzemez, iki katlı
 * sekme izlenimi doğmaz (WP3). İçerik kolonunun kenarına HİZALIDIR (negatif kenar boşluğu yok). Etkin sekme `--chip-on`
 * belirteciyle çizilir. Telefonda en çok 3 sekme görünür, kalanı hub şeridindeki gibi "Tümü +N" menüsündedir; etiketler
 * kesilmez, dokunma hedefi 44 px.
 */
export function SegmentTabs({
  items,
  active,
  label,
  className,
  scroll,
}: {
  items: readonly SegmentTabItem[];
  active: string;
  label: string;
  className?: string;
  /** false: sekme geçişinde sayfa başına kaydırılmaz (detay sayfaları). */
  scroll?: boolean;
}) {
  if (items.length < 2) return null;
  const phoneShown = segmentPhoneVisible(
    items.map((i) => i.id),
    active,
  );
  const overflow = items.filter((_, i) => !phoneShown.has(i));
  return (
    <nav aria-label={label} className={cn("no-print flex min-w-0 items-end gap-1 shadow-[inset_0_-1px_0_var(--line)]", className)}>
      <ul className="strip-fade flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => {
          const on = item.id === active;
          return (
            <li key={item.id} className={cn("shrink-0", !phoneShown.has(i) && "max-sm:hidden")}>
              <Link
                href={item.href}
                scroll={scroll}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] font-semibold transition-colors",
                  on ? "border-[var(--chip-on,var(--ink-950))] text-text" : "border-transparent text-text-muted hover:border-line hover:text-text",
                )}
              >
                {item.icon ? <item.icon className="h-3.5 w-3.5" aria-hidden /> : null}
                {item.label}
                {item.count != null ? (
                  <span className="rounded-full bg-surface-sunken px-1.5 text-xs font-bold tabular-nums text-text-muted">{item.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <MorphNavScrollActive activeId={active} />
      </ul>
      {overflow.length > 0 ? (
        <div className="shrink-0 sm:hidden">
          <MorphNavMore
            label={label}
            items={overflow.map((item) => ({
              id: item.id,
              href: item.href,
              label: item.label,
              count: item.count ?? null,
              iconNode: item.icon ? <item.icon className="text-text-muted" /> : null,
            }))}
          />
        </div>
      ) : null}
    </nav>
  );
}
