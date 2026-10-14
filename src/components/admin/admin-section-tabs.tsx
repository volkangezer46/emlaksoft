"use client";

import Link from "@/components/ui/smart-link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";
import { activeAdminItem, activeChildHref, activeTabHref, adminNavFor, splitTabs, type AdminNavConditions, type NavTab } from "@/lib/admin/nav";

/**
 * Bölüm sekmeleri: bulunulan sayfanın menü öğesinin `tabs` listesi varsa kabuk üstünde sekme şeridi çizer. /admin'in TEK
 * bölüm sekmesi mekanizmasıdır (sayfalar kendi bölüm sekmesi bileşenini taşımaz). Alt araçlar menüde ayrı satır olmaz, burada sekme olur. Sekme = ayrı sayfa (popup yok).
 * Sekmeler rol modüllerine göre süzülür; tek sekme kalırsa şerit çizilmez. En çok 5 görünür sekme: kalanlar (ve
 * `overflow` işaretliler) "Diğer ▾" (details/summary; klavyeyle açılır) altına girer; etkin sekme oradaysa "Diğer" etkin
 * görünür. Etkin sekmenin `children` listesi ikinci satırda çizilir.
 */
export function AdminSectionTabs({ modules, conditions }: { modules: readonly PlatformModule[]; conditions?: AdminNavConditions }) {
  const pathname = usePathname() ?? "";
  const sekme = useSearchParams()?.get("sekme");
  const item = activeAdminItem(pathname, adminNavFor(modules, conditions));
  const tabs = item?.tabs ?? [];
  if (tabs.length < 2) return null;
  // `?sekme=` taşıyan sekme (ör. Hata kayıtları = /admin/sistem?sekme=hatalar) aynı sekmede etkindir; bkz. activeTabHref.
  const current = activeTabHref(pathname, tabs, sekme);
  const tab = tabs.find((t) => t.href === current) ?? null;
  return <SectionTabsView label={item!.label} tabs={tabs} current={current} currentChild={activeChildHref(pathname, tab)} />;
}

const TAB_CLS = "focus-ring shrink-0 rounded-t-[var(--radius-control)] border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors";
const tabTone = (active: boolean) => (active ? "border-accent text-accent-text" : "border-transparent text-text-muted hover:text-ink-950");

/** Saf görünüm (render testi): hook yok, yalnız props. */
export function SectionTabsView({ label, tabs, current, currentChild }: { label: string; tabs: readonly NavTab[]; current: string | null; currentChild: string | null }) {
  const { visible, more } = splitTabs(tabs);
  const moreActive = more.some((t) => t.href === current);
  const children = tabs.find((t) => t.href === current)?.children ?? [];
  return (
    <div className="-mb-1 space-y-1">
      <nav aria-label={`${label} bölümleri`} className="flex items-end gap-1 border-b border-line pb-px">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {visible.map((t) => {
            const active = current === t.href;
            return (
              <Link key={t.href} href={t.href} title={t.description} aria-current={active ? "page" : undefined} className={`${TAB_CLS} ${tabTone(active)}`}>
                {t.label}
              </Link>
            );
          })}
        </div>
        {more.length ? (
          <details className="group relative shrink-0" data-section-more="">
            <summary
              className={`${TAB_CLS} ${tabTone(moreActive)} flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}
              aria-current={moreActive ? "page" : undefined}
            >
              Diğer <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <ul className="absolute right-0 z-30 mt-1 min-w-48 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-lg)]">
              {more.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    title={t.description}
                    aria-current={current === t.href ? "page" : undefined}
                    className={`focus-ring block rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold touch:min-h-11 ${current === t.href ? "bg-surface-hover text-accent-text" : "text-ink-950 hover:bg-surface-hover"}`}
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </nav>
      {children.length > 1 ? (
        <nav aria-label={`${tabs.find((t) => t.href === current)?.label ?? label} alt bölümleri`} className="flex gap-1 overflow-x-auto pt-1" data-section-children="">
          {children.map((c) => {
            const active = currentChild === c.href;
            return (
              <Link
                key={c.href}
                href={c.href}
                title={c.description}
                aria-current={active ? "page" : undefined}
                className={`focus-ring shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors touch:min-h-11 ${active ? "bg-accent/10 text-accent-text" : "text-text-muted hover:bg-surface-hover hover:text-ink-950"}`}
              >
                {c.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
