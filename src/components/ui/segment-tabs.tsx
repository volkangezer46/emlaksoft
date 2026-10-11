import type { ComponentType } from "react";
import Link from "@/components/ui/smart-link";
import { cn } from "@/lib/utils";

export type SegmentTabItem = {
  id: string;
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Sayaç rozeti; null/undefined ise gösterilmez. */
  count?: number | null;
};

/**
 * Sayfanın KENDİ iç sekmeleri için kompakt segment kontrolü (sunucu bileşeni; durum URL'de, `?sekme=`).
 * Hub sekme şeridinin (section-tabs) altında ikinci bir MorphNav/PageTabs şeridi yerine kullanılır: hub şeridi
 * alt çizgili, bu kontrol dolgulu kapsül görünümlüdür, böylece iki katlı sekme izlenimi doğmaz.
 * Yatay kaydırılır, etiketler mobilde de görünür, dokunma hedefi en az 44px.
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
  return (
    <nav aria-label={label} className={cn("no-print -mx-1 overflow-x-auto px-1 py-0.5", className)}>
      <ul className="inline-flex min-w-max items-center gap-1 rounded-full border border-line bg-canvas p-1">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                scroll={scroll}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition",
                  on ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
                )}
              >
                {item.icon ? <item.icon className="h-3.5 w-3.5" aria-hidden /> : null}
                {item.label}
                {item.count != null ? (
                  <span className="rounded-full bg-line px-1.5 text-xs font-bold tabular-nums text-text-muted">{item.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
