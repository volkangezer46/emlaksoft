"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, Lock, Menu, Sparkles, X } from "lucide-react";
// İkonografi tek kaynaktan: kavramsal ikonlar `src/lib/icons.ts` sözlüğünden gelir.
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import { resolveActiveNav, visibleSections, type NavItem, type VisibleSection } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
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
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Menü 9 iş başlığına indirgendi (bkz. src/lib/nav-config.ts). Başlıkta izinli
  // hiçbir sayfa yoksa başlık gizlenir; giriş bağlantısı ilk izinli sayfadır.
  const sections = useMemo(() => visibleSections(accessibleModules), [accessibleModules]);
  const { section: activeSection, href: activeHref } = resolveActiveNav(pathname, sections);

  const renderChild = (item: NavItem) => {
    const active = item.href === activeHref;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen(false)}
        onMouseEnter={() => router.prefetch(item.href)}
        onFocus={() => router.prefetch(item.href)}
        className={`flex items-center gap-2.5 rounded-[var(--radius-control)] py-2 pl-3 pr-2 text-sm transition ${
          active ? "bg-white/10 font-semibold text-white" : "text-white/75 hover:bg-white/6 hover:text-white"
        }`}
      >
        <item.icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-mint-400" : "text-white/45"}`} />
        <span className="flex-1 truncate">{item.label}</span>
        {lockedHrefs.some((h) => item.href === h || item.href.startsWith(`${h}/`)) ? (
          <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" />
        ) : null}
      </Link>
    );
  };

  const renderSection = (section: VisibleSection) => {
    const active = section.id === activeSection?.id;
    return (
      <div key={section.id}>
        <Link
          href={section.href}
          aria-current={active ? "true" : undefined}
          aria-expanded={active}
          onClick={() => setOpen(false)}
          onMouseEnter={() => router.prefetch(section.href)}
          onFocus={() => router.prefetch(section.href)}
          className={`group relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-control)] px-3 py-2.5 text-sm transition ${
            active ? "bg-white/10 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" : "text-white/80 hover:bg-white/6 hover:text-white"
          }`}
        >
          {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-mint-400" /> : null}
          <span className={`grid h-8 w-8 place-items-center rounded-[var(--radius-control)] transition ${active ? "bg-brand-600 text-white" : "bg-white/5 text-white/55 group-hover:bg-white/10 group-hover:text-cyan-400"}`}>
            <section.icon className="h-4 w-4" />
          </span>
          <span className="flex-1">{section.title}</span>
          <ChevronRight className={`h-3.5 w-3.5 transition ${active ? "rotate-90 text-mint-400" : "text-white/15 group-hover:translate-x-0.5"}`} />
        </Link>
        {active && section.items.length > 1 ? (
          <div className="ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-2">{section.items.map(renderChild)}</div>
        ) : null}
      </div>
    );
  };

  const content = (
    <>
      <div className="flex h-17 items-center gap-3 border-b border-white/8 px-5">
        <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] font-display text-base font-extrabold text-white shadow-[0_12px_28px_-12px_rgba(34,211,238,.75)]">E</span>
        <div>
          <p className="font-display text-base font-extrabold text-white">EmlakSoft</p>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-400">Command OS</p>
        </div>
      </div>

      <nav aria-label="Uygulama ana menüsü" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {sections.map(renderSection)}
      </nav>

      <div className="p-3">
        <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
          <div className="pointer-events-none absolute -right-7 -top-8 h-24 w-24 rounded-full bg-brand-600/25 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-amber-400">{trial ? "Deneme alanı" : "Aktif ofis"}</span>
          </div>
          <p className="relative mt-2 truncate text-sm font-bold text-white">{officeName}</p>
          <div className="relative mt-3 flex items-center justify-between">
            <span className="rounded-full bg-mint-400/12 px-2 py-1 text-xs font-semibold text-mint-400">{plan}</span>
            <span className="text-xs text-white/65">
              {officeScore != null ? `Skor ${officeScore}` : "Skor —"}
            </span>
          </div>
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
      <aside className="hidden w-[260px] shrink-0 flex-col bg-[linear-gradient(180deg,#071a38_0%,#041127_100%)] lg:flex">
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
