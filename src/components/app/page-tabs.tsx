import Link from "@/components/ui/smart-link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageTab = {
  /** `?sekme=` değeri. İlk sekme varsayılandır (parametresiz adres). */
  id: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Tek sayfada birleşen ekranların sekme çubuğu (sunucu bileşeni; durum URL'dedir).
 * Sekme görünürlüğü çağıran sayfada modül izniyle süzülür; çubuk yalnız görünen
 * sekmeleri alır. `base` sekmeler arası geçişte tutulan yoldur.
 */
export function PageTabs({
  base,
  label,
  tabs,
  active,
}: {
  base: string;
  label: string;
  tabs: readonly PageTab[];
  active: string;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="no-print -mx-1 overflow-x-auto px-1">
      <ul className="inline-flex min-w-max items-center gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
        {tabs.map((tab, i) => (
          <li key={tab.id}>
            <Link
              href={i === 0 ? base : `${base}?sekme=${tab.id}`}
              aria-current={tab.id === active ? "page" : undefined}
              className={cn(
                "focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition",
                tab.id === active
                  ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]"
                  : "text-text-muted hover:text-ink-950",
              )}
            >
              <tab.icon className="h-3.5 w-3.5" aria-hidden />
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Eski yoldan birleşik sayfaya geçerken sorgu parametrelerini koruyarak adres kurar. */
export function mergedHref(
  base: string,
  sekme: string | null,
  sp: Record<string, string | string[] | undefined>,
): string {
  const qs = new URLSearchParams();
  if (sekme) qs.set("sekme", sekme);
  for (const [key, value] of Object.entries(sp)) {
    if (key === "sekme") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v != null) qs.set(key, v);
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
