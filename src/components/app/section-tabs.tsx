"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Lock } from "lucide-react";
import { resolveActiveNav, visibleSections } from "@/lib/nav-config";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Aktif iş başlığındaki kardeş sayfalar için sekme çubuğu (ör. Müşteriler →
 * Talepler → Eşleştirme). Menü 9 başlığa indiği için sayfalar arası geçiş burada.
 * Başlıkta tek sayfa varsa görünmez. Kaynak: src/lib/nav-config.ts.
 *
 * Sekmeli menü öğesi (Komisyon / Cüzdanım / Onaylar gibi) etkinse altında ikinci
 * bir sekme satırı çıkar; yetkisiz sekmeler nav-config süzgecinde zaten yoktur.
 */
export function SectionTabs({
  accessibleModules,
  lockedHrefs = [],
}: {
  accessibleModules: AppModule[];
  /** Pakete dahil olmayan sayfalar (kilit simgesi). */
  lockedHrefs?: string[];
}) {
  const pathname = usePathname();
  const sections = useMemo(() => visibleSections(accessibleModules), [accessibleModules]);
  const { section, href: activeHref } = resolveActiveNav(pathname, sections);
  if (!section) return null;
  const current = sections.find((s) => s.id === section.id)!;
  const activeItem = current.items.find((i) => i.href === activeHref);
  const subTabs = activeItem?.tabs && activeItem.tabs.length > 1 ? activeItem.tabs : null;
  const activeTabHref = subTabs
    ? findActiveNavigationHref(pathname, subTabs.map((t) => t.href), "/app")
    : null;
  if (current.items.length < 2 && !subTabs) return null;

  const isLocked = (href: string) => lockedHrefs.some((h) => href === h || href.startsWith(`${h}/`));

  return (
    <div className="mb-4">
      {current.items.length >= 2 ? (
        <nav aria-label={`${current.title} sayfaları`} className="-mx-1 overflow-x-auto px-1 pb-1">
          <ul className="flex min-w-max items-center gap-1 border-b border-line">
            {current.items.map((item) => {
              const active = item.href === activeHref;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                      active
                        ? "border-accent font-semibold text-text"
                        : "border-transparent text-text-muted hover:border-line-strong hover:text-text",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" aria-hidden />
                    {item.label}
                    {isLocked(item.href) ? (
                      <Lock className="h-3 w-3 text-amber-600" aria-label="Paketinize dahil değil" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      {subTabs ? (
        <nav aria-label={`${activeItem?.label} sekmeleri`} className="-mx-1 mt-3 overflow-x-auto px-1">
          <ul className="inline-flex min-w-max items-center gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
            {subTabs.map((tab) => {
              const active = tab.href === activeTabHref;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition",
                      active
                        ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]"
                        : "text-text-muted hover:text-ink-950",
                    )}
                  >
                    <tab.icon className="h-3.5 w-3.5" aria-hidden />
                    {tab.label}
                    {isLocked(tab.href) ? (
                      <Lock className="h-3 w-3 text-amber-600" aria-label="Paketinize dahil değil" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
