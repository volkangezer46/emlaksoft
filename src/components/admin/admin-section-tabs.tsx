"use client";

import Link from "@/components/ui/smart-link";
import { usePathname } from "next/navigation";
import type { PlatformModule } from "@/lib/platform-access";
import { activeAdminItem, activeTabHref, adminNavFor } from "@/lib/admin/nav";

/**
 * Bölüm sekmeleri: bulunulan sayfanın menü öğesinin `tabs` listesi varsa (Site & marka, Sistem, Ayarlar) kabuk
 * üstünde sekme şeridi çizer. Alt araçlar menüde ayrı satır olmaz, burada sekme olur. Sekme = ayrı sayfa (popup yok).
 * Sekmeler rol modüllerine göre süzülür; tek sekme kalırsa şerit çizilmez.
 */
export function AdminSectionTabs({ modules }: { modules: readonly PlatformModule[] }) {
  const pathname = usePathname() ?? "";
  const item = activeAdminItem(pathname, adminNavFor(modules));
  const tabs = item?.tabs ?? [];
  if (tabs.length < 2) return null;
  const current = activeTabHref(pathname, tabs);
  return (
    <nav aria-label={`${item!.label} bölümleri`} className="-mb-1 flex gap-1 overflow-x-auto border-b border-line pb-px">
      {tabs.map((t) => {
        const active = current === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            title={t.description}
            aria-current={active ? "page" : undefined}
            className={`focus-ring shrink-0 rounded-t-[var(--radius-control)] border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors ${
              active ? "border-accent text-accent-text" : "border-transparent text-text-muted hover:text-ink-950"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
