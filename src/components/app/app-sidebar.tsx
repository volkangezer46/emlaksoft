"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Menu, Search, Sparkles, X } from "lucide-react";
// İkonografi tek kaynaktan: kavramsal ikonlar `src/lib/icons.ts` sözlüğünden gelir.
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import { resolveActiveNav, visibleSections, type NavItem, type VisibleSection } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";

export function AppSidebar({
  officeName,
  plan,
  trial,
  officeScore = null,
  accessibleModules,
  lockedHrefs = [],
}: {
  officeName: string;
  plan: string;
  trial: boolean;
  officeScore?: number | null;
  /** Etkin izinlere göre erişilebilir modüller (bkz. `getEffectivePermissions`, tenant override'larını içerir) */
  accessibleModules: AppModule[];
  /** Pakete dahil olmayan sayfalar: menüde kilit simgesi, tıklayınca yükseltme sayfası. */
  lockedHrefs?: string[];
}) {
  const pathname = usePathname();
  // Prefetch: next/link varsayılanı (görünür alanda + hover) yeterli; elle router.prefetch yağmuru kaldırıldı.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Menü 9 iş başlığına indirgendi (bkz. src/lib/nav-config.ts). Başlıkta izinli
  // hiçbir sayfa yoksa başlık gizlenir; giriş bağlantısı ilk izinli sayfadır.
  const sections = useMemo(() => visibleSections(accessibleModules), [accessibleModules]);
  const { section: activeSection, href: activeHref } = resolveActiveNav(pathname, sections);

  // Akordeon: aktif başlık otomatik açık; kullanıcı açıp kapatabilir. Aktif başlık
  // değişince (gezinme) elle yapılan tercihler sıfırlanır.
  const activeId = activeSection?.id ?? null;
  const [accordion, setAccordion] = useState<{ forId: string | null; map: Record<string, boolean> }>({ forId: activeId, map: {} });
  if (accordion.forId !== activeId) setAccordion({ forId: activeId, map: {} });
  const isOpen = (id: string) => accordion.map[id] ?? id === activeId;
  const toggleSection = (id: string) => setAccordion((a) => ({ ...a, map: { ...a.map, [id]: !isOpen(id) } }));

  // Menü araması: yalnız izinli sayfalar (sections zaten izinle süzülü) üzerinde, Türkçe-duyarlı.
  const needle = query.trim().toLocaleLowerCase("tr-TR");
  const matches = needle
    ? sections.flatMap((s) => s.items).filter((i) => i.label.toLocaleLowerCase("tr-TR").includes(needle))
    : null;

  const renderChild = (item: NavItem) => {
    const active = item.href === activeHref;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(false)}
        className={`flex items-center gap-2.5 rounded-[var(--radius-control)] py-2 pl-3 pr-2 text-sm transition ${
          active ? "nav-gold-active font-semibold" : "text-white/80 hover:bg-white/6 hover:text-white"
        }`}
      >
        <item.icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-[var(--gold-300)]" : "text-white/60"}`} />
        <span className="sb-label flex-1 truncate">{item.label}</span>
        {lockedHrefs.some((h) => item.href === h || item.href.startsWith(`${h}/`)) ? (
          <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" />
        ) : null}
      </Link>
    );
  };

  const renderSection = (section: VisibleSection) => {
    const active = section.id === activeSection?.id;
    const expandable = section.items.length > 1;
    const expanded = expandable && isOpen(section.id);
    return (
      <div key={section.id}>
        <div className="relative flex items-center">
          <Link
            href={section.href}
            aria-current={active ? "true" : undefined}
            title={section.title}
            onClick={() => setOpen(false)}
            className={`sb-row group relative flex min-h-10 min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors ${
              active ? "nav-gold-active font-semibold" : "text-white/80 hover:bg-white/6 hover:text-white"
            } ${expandable ? "pr-9" : ""}`}
          >
            {active ? <span className="nav-gold-bar absolute inset-y-2 left-0 w-0.5 rounded-full" /> : null}
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] transition-colors ${active ? "bg-[var(--gold-300)]/20 text-[var(--gold-300)]" : "bg-white/5 text-white/65 group-hover:bg-white/10 group-hover:text-white"}`}>
              <section.icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="sb-label min-w-0 flex-1 truncate">{section.title}</span>
          </Link>
          {expandable ? (
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              aria-expanded={expanded}
              aria-controls={`sb-${section.id}`}
              aria-label={`${section.title} alt sayfalarını ${expanded ? "daralt" : "aç"}`}
              className="sb-label focus-ring absolute right-1 grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div id={`sb-${section.id}`} className="sb-label ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-2">
            {section.items.map(renderChild)}
          </div>
        ) : null}
      </div>
    );
  };

  const content = (
    <>
      <div className="sb-head flex h-14 items-center gap-3 border-b border-white/8 px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] font-display text-base font-extrabold text-white shadow-[0_12px_28px_-12px_rgba(34,211,238,.75)]">E</span>
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-base font-extrabold leading-5 text-white">EmlakSoft</p>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-400">Command OS</p>
        </div>
        <SidebarCollapseButton />
      </div>

      <div className="sb-pad px-3 pt-4">
        <label className="nav-search sb-label">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Menülerde ara…"
            aria-label="Menülerde ara"
            autoComplete="off"
          />
        </label>
      </div>

      <nav aria-label="Uygulama ana menüsü" className="sb-pad flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {matches ? (
          matches.length > 0 ? (
            <>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">Sonuçlar</p>
              {matches.map(renderChild)}
            </>
          ) : (
            <p className="px-3 py-2 text-sm text-white/75">“{query.trim()}” için menü bulunamadı.</p>
          )
        ) : (
          sections.map(renderSection)
        )}
      </nav>

      <div className="sb-pad p-3">
        <div
          className="sb-when-collapsed mx-auto h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-white/10 bg-white/8 font-display text-sm font-extrabold text-[var(--gold-300)]"
          title={`${officeName} · ${plan}`}
          role="img"
          aria-label={`${officeName}, ${plan} paketi`}
        >
          {officeName.trim().charAt(0).toLocaleUpperCase("tr-TR") || "E"}
        </div>
        <div className="sb-label relative overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
          <div className="pointer-events-none absolute -right-7 -top-8 h-24 w-24 rounded-full bg-brand-600/25 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-amber-400">{trial ? "Deneme alanı" : "Aktif ofis"}</span>
          </div>
          <p className="relative mt-2 truncate text-sm font-bold text-white">{officeName}</p>
          <div className="relative mt-3 flex items-center justify-between">
            <span className="rounded-full bg-mint-400/12 px-2 py-1 text-xs font-semibold text-mint-400">{plan}</span>
            <span className="text-xs text-white/65">
              {officeScore != null ? `Skor ${officeScore}` : "Skor —"}
            </span>
          </div>
          {accessibleModules.includes("billing") ? (
            <Link
              href="/app/abonelik"
              onClick={() => setOpen(false)}
              className="relative mt-3 flex items-center justify-between rounded-[var(--radius-control)] bg-white/8 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/14"
            >
              {trial ? "Paketini seç" : "Paket ve kullanım"}
              <ChevronRight className="h-3.5 w-3.5 text-mint-400" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );

  // Mobil alt gezinme: en sık kullanılan dört rota + menü çekmecesi.
  // İzin filtresi sidebar ile aynı kaynaktan (accessibleModules) beslenir.
  const tabItems = [
    { href: "/app", label: "Ana ekran", icon: ICONS.dashboard, module: "dashboard" as AppModule },
    { href: "/app/musteriler", label: "Müşteri", icon: ICONS.musteri, module: "customers" as AppModule },
    { href: "/app/portfoyler", label: "Portföy", icon: ICONS.portfoy, module: "properties" as AppModule },
    { href: "/app/randevular", label: "Randevu", icon: ICONS.randevu, module: "appointments" as AppModule },
  ].filter((t) => accessibleModules.includes(t.module));
  const activeTabHref = findActiveNavigationHref(
    pathname,
    tabItems.map((item) => item.href),
    "/app",
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-ink-950 text-white shadow-[var(--shadow-card)] lg:hidden" aria-label="Panel menüsünü aç">
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <aside className="shell-aside sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#071a38_0%,#041127_100%)] lg:flex">
        {content}
      </aside>
      <DialogDrawerContent id="app-mobile-navigation" aria-describedby={undefined} responsiveClassName="lg:hidden">
        <DialogTitleHidden>Panel menüsü</DialogTitleHidden>
        <aside className="flex h-full flex-col bg-[linear-gradient(180deg,#071a38_0%,#041127_100%)]">
          <DialogClose asChild>
            <button type="button" className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80" aria-label="Kapat"><X className="h-5 w-5" /></button>
          </DialogClose>
          {content}
        </aside>
      </DialogDrawerContent>
      <nav
        aria-label="Mobil hızlı gezinme"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            const active = tab.href === activeTabHref;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-semibold transition ${
                  active ? "text-brand-600" : "text-text-faint hover:text-ink-950"
                }`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${active ? "bg-brand-600/12" : ""}`}>
                  <tab.icon className="h-[18px] w-[18px]" />
                </span>
                {tab.label}
              </Link>
            );
          })}
          <DialogTrigger asChild>
            <button type="button" className="flex flex-col items-center gap-1 py-2.5 text-xs font-semibold text-text-faint transition hover:text-ink-950">
              <span className="grid h-7 w-11 place-items-center rounded-full">
                <Menu className="h-[18px] w-[18px]" />
              </span>
              Menü
            </button>
          </DialogTrigger>
        </div>
      </nav>
    </Dialog>
  );
}
