"use client";

import Link from "next/link";
import { Brand } from "@/components/brand/brand";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ChevronDown, ExternalLink, Globe, Menu, X, Crown } from "lucide-react";
import { platformModulesFor, type PlatformRole } from "@/lib/platform-access";
import { adminNavFor, isAdminNavActive, type AdminNavItem } from "@/lib/admin/nav";
import { getHrefStore } from "@/lib/nav-memory";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";

type Item = AdminNavItem;
const isActive = (pathname: string, item: Item) => isAdminNavActive(pathname, item);

export function AdminSidebar({
  staffName,
  role,
  roleLabel,
  badges,
}: {
  staffName: string;
  role: PlatformRole;
  roleLabel: string;
  badges?: { tickets?: number; risk?: number };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const allowed = platformModulesFor(role);

  // Kapalı bölümler: kullanıcı tercihi (localStorage, try/catch store). Aktif sayfanın bölümü hep açık.
  const closedStore = getHrefStore("closed", "admin");
  const closed = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggle = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  // Menü tek kaynaktan (src/lib/admin/nav.ts): role göre süzülür, boş bölüm atılır.
  const sections = adminNavFor(allowed);

  // Mobil alt gezinme: erişilebilir ilk dört rota + menü çekmecesi.
  const tabItems = sections.flatMap((s) => s.items).slice(0, 4);
  const allItems = sections.flatMap((s) => s.items);

  const renderItem = (item: Item) => {
    const active = isActive(pathname, item);
    const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
    return (
      <div key={item.href} className="nav-item group relative">
        <Link
          href={item.href}
          data-nav-link
          data-nav-active={active ? "true" : undefined}
          aria-current={active ? "page" : undefined}
          title={`${item.label} · ${item.description}`}
          prefetch
          onClick={() => setOpen(false)}
          onMouseEnter={() => router.prefetch(item.href)}
          onFocus={() => router.prefetch(item.href)}
          className={`focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors md:min-h-10 ${
            badge && badge > 0 ? "pr-12" : "pr-3"
          } ${active ? "nav-pill font-semibold text-white" : "text-white/80 hover:bg-white/6 hover:text-white"}`}
        >
          <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-white/65 group-hover:text-white"}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </Link>
        {badge && badge > 0 ? (
          <span
            aria-label={`${badge} bekleyen`}
            className={`nav-badge pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${item.badgeKey === "risk" ? "is-danger" : "is-warn"}`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </div>
    );
  };

  const renderContent = (variant: "desktop" | "drawer") => (
    <aside className="sb-surface flex h-full w-full flex-col">
      {/* Arama üst çubukta (Ctrl K); menüde ikinci arama kutusu yok. */}
      <div className="sb-head relative flex min-h-16 shrink-0 items-center gap-3 border-b border-white/8 px-4 py-3">
        <Brand variant="mark" tone="dark" height={38} alt="" className="rounded-[var(--radius-card)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="truncate font-display text-base font-extrabold leading-5 text-white">EmlakSoft</p>
          <p className="truncate text-xs leading-4 text-white/75">Platform</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-bold uppercase tracking-[0.1em] text-[var(--gold-300)]">
            <Crown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {roleLabel}
          </p>
        </div>
        <SidebarCollapseButton />
      </div>

      <NavScroller label="Platform menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          {sections.map((section) => {
            const hasActive = section.items.some((i) => isActive(pathname, i));
            const expanded = !section.title || hasActive || !closed.includes(section.id);
            return (
              <div key={section.id}>
                {section.title ? (
                  <div className="sb-eyebrow flex items-center gap-2 px-3 pb-1 pt-4 text-white/70">
                    <button
                      type="button"
                      onClick={() => toggle(section.id)}
                      disabled={hasActive}
                      aria-expanded={expanded}
                      aria-controls={`adm-${section.id}`}
                      className="focus-ring flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] text-left uppercase transition-colors hover:text-white disabled:cursor-default"
                    >
                      <span className="shrink-0">{section.title}</span>
                      <span className="h-px flex-1 bg-white/10" aria-hidden />
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
                      <span className="sr-only">{expanded ? "bölümü daralt" : "bölümü aç"}</span>
                    </button>
                  </div>
                ) : (
                  <div className="pt-3" />
                )}
                {expanded ? (
                  <div id={`adm-${section.id}`} className="space-y-0.5">
                    {section.items.map(renderItem)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* İkon modu: her öğe ikon + hover'da başlık/ipucu (erişilebilir tooltip) */}
        <div className="sb-rail space-y-1 pt-3">
          {allItems.map((item) => {
            const active = isActive(pathname, item);
            const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
            return (
              <NavFlyout
                key={item.href}
                enabled={variant === "desktop"}
                title={`${item.label} · ${item.description}`}
                href={item.href}
              >
                <Link
                  href={item.href}
                  data-nav-link
                  data-nav-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    active ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px]" aria-hidden />
                  {badge && badge > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-400" aria-hidden /> : null}
                </Link>
              </NavFlyout>
            );
          })}
        </div>
      </NavScroller>

      <div className="sb-pad space-y-2 border-t border-white/8 p-3">
        <div className="sb-when-collapsed mx-auto h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-white/8 font-display text-sm font-extrabold text-amber-300" role="img" aria-label={`${staffName}, ${roleLabel}`} title={`${staffName} · ${roleLabel}`}>
          {staffName.trim().charAt(0).toLocaleUpperCase("tr-TR") || "P"}
        </div>

        {/* Sistem durumu: üst çubukta kompakt çip (SystemStatusChip); menüde yer kaplayan kart kaldırıldı. */}
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          title="Ana siteyi yeni sekmede aç"
          className="focus-ring flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white"
        >
          <Globe className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
          <span className="sb-label flex-1 truncate">Siteyi görüntüle</span>
          <ExternalLink className="sb-label h-3.5 w-3.5 shrink-0 text-white/60" aria-hidden />
        </a>
      </div>
    </aside>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Mobil: hamburger (amber, admin teması) — masaüstünde gizli */}
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Admin menüsünü aç"
          className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-[var(--navy-800)] text-white shadow-[var(--elev-3)] md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>

      {/* Masaüstü sabit sidebar */}
      <div className="shell-aside sticky top-0 hidden h-screen shrink-0 self-start overflow-hidden md:block">{renderContent("desktop")}</div>

      {/* Mobil çekmece — focus trap, Escape, scroll lock ve focus restore Radix'ten gelir. */}
      <DialogDrawerContent id="admin-mobile-navigation" aria-describedby={undefined}>
        <DialogTitleHidden>Admin menüsü</DialogTitleHidden>
        <DialogClose asChild>
          <button type="button" className="absolute right-3 top-2 z-10 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80" aria-label="Kapat"><X className="h-5 w-5" /></button>
        </DialogClose>
        {renderContent("drawer")}
      </DialogDrawerContent>

      {/* Mobil alt gezinme */}
      <nav
        aria-label="Admin hızlı gezinme"
        // Cam bütçesi: alt çubuk opak (cam yalnız sabit ÜST çubukta).
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[var(--sb-bg-bottom)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            const active = isActive(pathname, tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition ${active ? "text-white" : "text-white/70 hover:text-white"}`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${active ? "bg-[var(--accent)]" : ""}`}>
                  <tab.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="max-w-full truncate px-0.5">{tab.label}</span>
              </Link>
            );
          })}
          <DialogTrigger asChild>
            <button type="button" className="flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold text-white/70 transition hover:text-white">
              <span className="grid h-7 w-11 place-items-center rounded-full"><Menu className="h-[18px] w-[18px]" /></span>
              Menü
            </button>
          </DialogTrigger>
        </div>
      </nav>
    </Dialog>
  );
}
