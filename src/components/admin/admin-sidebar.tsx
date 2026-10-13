"use client";

import Link from "@/components/ui/smart-link";
import { Brand } from "@/components/brand/brand";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import { ChevronDown, Crown, ExternalLink, Globe, Menu, Pin, PinOff } from "lucide-react";
import { platformModulesFor, type PlatformRole } from "@/lib/platform-access";
import { activeTabHref, adminSidebarModel, adminTabPathname, isAdminNavActive, type AdminNavItem, type AdminSidebarGroup } from "@/lib/admin/nav";
import { getHrefStore } from "@/lib/nav-memory";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { MenuSearchButton, QuickAccessSection, useQuickAccess, type QuickItem } from "@/components/ui/console/quick-access";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import { useMobileMenu } from "@/components/app/mobile-menu-trigger";

// Radix Dialog gövdesi (mobil çekmece) yalnız küçük ekranda gerekir: masaüstü kabuk paketine girmez.
const drawerPanel = lazyPanel(() => import("@/components/admin/admin-sidebar-drawer").then((m) => m.AdminSidebarDrawer));
/** Tailwind `md` altı (çekmece kırılımı): yalnız burada boşta önceden yükleme yapılır. */
const SMALL_SCREEN_QUERY = "(max-width: 767.98px)";

type Item = AdminNavItem;
const isActive = (pathname: string, item: Item) => isAdminNavActive(pathname, item);
const ADMIN_SCOPE = "admin";

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
  const sekme = useSearchParams()?.get("sekme");
  const router = useRouter();
  // Çekmece durumu üst kısımdaki hamburger (MobileMenuTrigger, admin layout) ile ortak bağlamda.
  const { open, setOpen, requestOpen: openDrawer, openerRef: drawerOpenerRef, register: registerMenu } = useMobileMenu();
  const { Panel: Drawer, open: mountDrawer, warm: warmDrawer } = useDeferredPanel(drawerPanel, { idle: false });
  useEffect(() => registerMenu({ mount: mountDrawer, warm: warmDrawer }), [registerMenu, mountDrawer, warmDrawer]);
  useEffect(() => {
    if (!window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    return runWhenIdle(drawerPanel.preload);
  }, []);
  const allowed = platformModulesFor(role);

  // Menü tek kaynaktan (src/lib/admin/nav.ts): role göre süzülür, her grupta çekirdek öğeler görünür, kalanı "+N daha".
  const groups = useMemo(() => adminSidebarModel(allowed), [allowed]);
  const allItems = useMemo(() => groups.flatMap((g) => [...g.items, ...g.folded]), [groups]);
  const activeItem = allItems.find((i) => isActive(pathname, i)) ?? null;
  const activeHref = activeItem?.href ?? null;

  // Menü durumu (localStorage, try/catch store): "o-<grup>" = grubun ek öğeleri açık. Aktif sayfanın grubu hep açık.
  const closedStore = getHrefStore("closed", ADMIN_SCOPE);
  const closed = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggle = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const quickItems = useMemo<QuickItem[]>(() => allItems.map((i) => ({ href: i.href, label: i.label, icon: i.icon, description: i.description })), [allItems]);
  const itemByHref = useMemo(() => new Map(allItems.map((i) => [i.href, i])), [allItems]);
  const quick = useQuickAccess({ scope: ADMIN_SCOPE, kind: "admin", items: quickItems, activeHref });

  // Mobil alt gezinme: erişilebilir ilk dört çekirdek rota + menü çekmecesi.
  const tabItems = groups.flatMap((g) => g.items).slice(0, 4);

  const renderItem = (item: Item, opts: { group: string; flat?: boolean }) => {
    const active = isActive(pathname, item);
    const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
    const hasBadge = Boolean(badge && badge > 0);
    const pinned = quick.pins.includes(item.href);
    // Ana ilke: yan menüde yalnız üst düzey sayfa; sekmeler sayfa içi şeritte (ikon modu flyout'u hariç).
    const badgeRight = 0.5;
    const pinRight = hasBadge ? 2.5 : 0.25;
    const padRight = hasBadge ? "pr-16" : "pr-9";
    return (
      <div key={`${opts.group}-${item.href}`}>
        <div className="nav-item group relative">
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
            className={`focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors md:min-h-10 ${padRight} ${
              active ? "nav-pill font-semibold text-white" : "text-white/80 hover:bg-white/6 hover:text-white"
            }`}
          >
            <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-white/65 group-hover:text-white"}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </Link>
          {hasBadge ? (
            <span
              aria-label={`${badge} bekleyen`}
              style={{ right: `${badgeRight}rem` }}
              className={`nav-badge pointer-events-none absolute top-1/2 -translate-y-1/2 ${item.badgeKey === "risk" ? "is-danger" : "is-warn"}`}
            >
              {badge! > 99 ? "99+" : badge}
            </span>
          ) : null}
          <button
            type="button"
            aria-pressed={pinned}
            aria-label={pinned ? `${item.label} sabitlemesini kaldır` : `${item.label} sayfasını sabitle`}
            title={pinned ? "Sabitlemeyi kaldır" : "Menüye sabitle"}
            onClick={() => quick.togglePin(item.href)}
            style={{ right: `${pinRight}rem` }}
            className="nav-pin focus-ring absolute top-1/2 grid h-7 w-7 touch:h-11 touch:w-11 -translate-y-1/2 place-items-center rounded-[var(--radius-control)] text-white/60 hover:bg-white/10 hover:text-white"
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>
    );
  };

  // Tek öğeli grup: başlıksız düz satır. Çok öğeli grup: başlık + çekirdek satır(lar) hep görünür (menü bütçesi <= 6);
  // grubun ek öğeleri başlıktaki düğmeyle açılır (varsayılan kapalı, tercih hatırlanır; etkin öğe içerideyse hep açık).
  const renderGroup = ({ section, items, folded }: AdminSidebarGroup) => {
    if (folded.length === 0 && items.length === 1) {
      return (
        <div key={section.id} className="pt-1">
          {renderItem(items[0]!, { group: section.id })}
        </div>
      );
    }
    const foldedActive = folded.some((i) => isActive(pathname, i));
    const expanded = foldedActive || closed.includes(`o-${section.id}`);
    return (
      <div key={section.id}>
        <div className="sb-eyebrow flex items-center gap-2 px-3 pb-1.5 pt-4 text-white/65">
          {folded.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(`o-${section.id}`)}
              disabled={foldedActive}
              aria-expanded={expanded}
              aria-controls={`adm-${section.id}`}
              className="focus-ring flex min-h-8 max-md:min-h-11 touch:min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] text-left uppercase transition-colors hover:text-white disabled:cursor-default"
            >
              <span className="shrink-0">{section.title}</span>
              <span className="h-px flex-1 bg-white/10" aria-hidden />
              {!expanded ? (
                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-white/10 px-1.5 text-xs font-bold tabular-nums normal-case text-white/80">{folded.length}</span>
              ) : null}
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
              <span className="sr-only">{expanded ? "ek sayfaları gizle" : "ek sayfaları göster"}</span>
            </button>
          ) : (
            <>
              <span className="shrink-0 uppercase">{section.title}</span>
              <span className="h-px flex-1 bg-white/10" aria-hidden />
            </>
          )}
        </div>
        <div className="space-y-0.5">
          {items.map((i) => renderItem(i, { group: section.id }))}
          {expanded && folded.length > 0 ? (
            <div id={`adm-${section.id}`} className="space-y-0.5">
              {folded.map((i) => renderItem(i, { group: section.id }))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const railFlyoutItems = (item: Item) =>
    item.tabs && item.tabs.length > 1
      ? item.tabs.map((t) => ({ href: t.href, label: t.label, icon: item.icon, active: isActive(pathname, item) && activeTabHref(adminTabPathname(pathname, sekme), item.tabs ?? []) === t.href.split(/[?#]/)[0] }))
      : [];

  const renderContent = (variant: "desktop" | "drawer") => (
    <aside className="sb-surface flex h-full min-h-0 w-full flex-col max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-[env(safe-area-inset-left)] max-md:pt-[env(safe-area-inset-top)]">
      <div className="sb-head relative flex min-h-16 shrink-0 items-center gap-3 border-b border-white/8 px-4 py-3">
        <Brand variant="mark" tone="dark" height={38} alt="" className="rounded-[var(--radius-card)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="truncate font-display text-base font-extrabold leading-5 tracking-tight text-white">EmlakSoft</p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium leading-4 text-white/70">Platform</span>
            <span
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--gold-300)]/35 bg-gradient-to-r from-[var(--gold-300)]/20 to-[var(--gold-300)]/5 px-2 py-0.5 text-xs font-semibold leading-4 text-[var(--gold-300)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              title={roleLabel}
            >
              <Crown className="h-3 w-3 shrink-0" aria-hidden />
              {roleLabel}
            </span>
          </div>
        </div>
        <SidebarCollapseButton />
      </div>

      {/* "Menüde ara" komut paletini açar (Ctrl K); ikinci bir arama kutusu yok. */}
      <MenuSearchButton onActivate={() => setOpen(false)} />

      <NavScroller label="Platform menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          <QuickAccessSection
            pinned={quick.pinned}
            auto={quick.auto}
            hasUsage={quick.hasUsage}
            onReset={quick.resetUsage}
            renderRow={(q, kind) => {
              const item = itemByHref.get(q.href);
              return item ? renderItem(item, { group: kind, flat: true }) : null;
            }}
          />
          {groups.map(renderGroup)}
        </div>

        {/* İkon modu: her öğe ikon + hover/odakta alt sayfalar ve ipucu (erişilebilir flyout) */}
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
                items={railFlyoutItems(item)}
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
          className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white md:min-h-10"
        >
          <Globe className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
          <span className="sb-label flex-1 truncate">Siteyi görüntüle</span>
          <ExternalLink className="sb-label h-3.5 w-3.5 shrink-0 text-white/60" aria-hidden />
        </a>
      </div>
    </aside>
  );

  return (
    <>
      {/* Masaüstü sabit sidebar */}
      <div className="shell-aside sticky top-0 hidden h-screen shrink-0 self-start overflow-hidden md:block">{renderContent("desktop")}</div>

      {/* Mobil çekmece — focus trap, Escape ve scroll lock Radix'ten gelir (parça ilk dokunuşta yüklenir); odak açan düğmeye döner. */}
      {Drawer ? (
        <Suspense fallback={null}>
          <Drawer open={open} onOpenChange={setOpen} render={() => renderContent("drawer")} restoreFocusTo={() => drawerOpenerRef.current} />
        </Suspense>
      ) : null}

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
                aria-label={tab.short ? tab.label : undefined}
                title={tab.label}
                onClick={() => setOpen(false)}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition ${active ? "text-white" : "text-white/70 hover:text-white"}`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${active ? "bg-[var(--accent)]" : ""}`}>
                  <tab.icon className="h-[18px] w-[18px]" />
                </span>
                {/* Dar yuvada kısa ad (ör. "Panel", "Site"); tam ad aria-label/title'da. */}
                <span className="max-w-full truncate px-0.5">{tab.short ?? tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openDrawer}
            onPointerEnter={warmDrawer}
            onFocus={warmDrawer}
            onTouchStart={warmDrawer}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="admin-mobile-navigation"
            className="flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
          >
            <span className="grid h-7 w-11 place-items-center rounded-full"><Menu className="h-[18px] w-[18px]" /></span>
            Menü
          </button>
        </div>
      </nav>
    </>
  );
}
