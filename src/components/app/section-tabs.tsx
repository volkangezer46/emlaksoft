"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { resolveActiveNav, visibleSections } from "@/lib/nav-config";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";

/**
 * Aktif iş başlığındaki kardeş sayfalar için sekme çubuğu (ör. Müşteriler →
 * Talepler → Eşleştirme). Menü 9 başlığa indiği için sayfalar arası geçiş burada.
 * Başlıkta tek sayfa varsa görünmez. Kaynak: src/lib/nav-config.ts.
 *
 * Sekmeli menü öğesi (Komisyon / Cüzdanım / Onaylar gibi) etkinse altında ikinci
 * bir sekme satırı çıkar; yetkisiz sekmeler nav-config süzgecinde zaten yoktur.
 */
/**
 * Kabuk verisi (izinler) akarken sekme çubuğunun yerini tutan iskelet: aktif başlık TAM erişimde ≥2 sayfa
 * içeriyorsa sekme satırı yüksekliği kadar yer ayrılır (içerik geldiğinde sayfa aşağı kaymasın). Link çizmez
 * (yetkisiz sekme bir an bile görünmez).
 */
export function SectionTabsPlaceholder({ allModules }: { allModules: AppModule[] }) {
  const pathname = usePathname();
  const sections = useMemo(() => visibleSections(allModules, { closed: [] }), [allModules]);
  const { section, href: activeHref } = resolveActiveNav(pathname, sections);
  if (!section) return null;
  const current = sections.find((s) => s.id === section.id)!;
  const activeItem = current.items.find((i) => i.href === activeHref);
  const hasSub = Boolean(activeItem?.tabs && activeItem.tabs.length > 1);
  if (current.items.length < 2 && !hasSub) return null;
  return (
    <div className="mb-4" aria-hidden="true">
      {current.items.length >= 2 ? <div className="skeleton h-10 w-full max-w-xl rounded-[var(--radius-control)]" /> : null}
      {hasSub ? <div className="skeleton mt-3 h-9 w-full max-w-md rounded-[var(--radius-control)]" /> : null}
    </div>
  );
}

export function SectionTabs({
  accessibleModules,
  lockedHrefs = [],
  counts,
  actions,
}: {
  accessibleModules: AppModule[];
  /** Pakete dahil olmayan sayfalar (kilit simgesi). */
  lockedHrefs?: string[];
  /** Sekme href -> GERÇEK kayıt sayısı (mevcut sorgulardan). Verilmeyen sekmede sayaç gösterilmez. */
  counts?: Record<string, number>;
  /** Şeridin sağındaki isteğe bağlı eylem alanı (filtre/ayar düğmesi). */
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const closedModules = useClosedModules();
  const sections = useMemo(() => visibleSections(accessibleModules, { closed: closedModules }), [accessibleModules, closedModules]);
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
        <div className="flex items-start gap-2">
          <MorphNav
            variant="underline"
            label={`${current.title} sayfaları`}
            activeId={activeHref}
            className="min-w-0 flex-1"
            // Yönetim öğeleri şeridin sonunda: 6'dan fazla sayfa varsa taşanlar "Daha fazla" menüsüne iner (menüdeki Yönetim katlamasıyla tutarlı).
            items={[...current.items.filter((i) => i.group !== "yonetim"), ...current.items.filter((i) => i.group === "yonetim")].map((item) => ({
              id: item.href,
              href: item.href,
              label: item.label,
              icon: item.icon,
              count: counts?.[item.href] ?? null,
              locked: isLocked(item.href),
            }))}
          />
          {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
        </div>
      ) : null}
      {subTabs ? (
        <MorphNav
          label={`${activeItem?.label} sekmeleri`}
          activeId={activeTabHref}
          className="mt-3"
          items={subTabs.map((tab) => ({
            id: tab.href,
            href: tab.href,
            label: tab.label,
            icon: tab.icon,
            count: counts?.[tab.href] ?? null,
            locked: isLocked(tab.href),
          }))}
        />
      ) : null}
    </div>
  );
}
