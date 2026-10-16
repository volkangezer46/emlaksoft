"use client";

import Link from "@/components/ui/smart-link";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { Brand } from "@/components/brand/brand";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Lock, Menu, Plus, type LucideIcon } from "lucide-react";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import { getHrefStore, pushRecent } from "@/lib/nav-memory";
import { resolveActiveHubIn, type ShellAction, type ShellHub, type ShellIcon, type ShellNavSet, type ShellPage } from "@/lib/nav-shell";
import { glyph, useShellNav } from "@/components/app/nav-glyph";
import { useMobileMenu } from "@/components/app/mobile-menu-trigger";
import { mobileNewActions, SHEET_ROW_CLASS, splitNewActions } from "@/components/app/mobile-new-sheet";
import { clearTapVeilAttr, pressOpenHandlers, TAP_VEIL_CLASS, useTapVeil } from "@/components/app/tap-veil";
import { OfficeStatusChip } from "@/components/app/office-status-chip";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { DrawerGroup } from "@/components/ui/console/drawer-kit";
import { MenuSearchButton } from "@/components/ui/console/quick-access";
import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";
import { useInboxBadge } from "@/components/app/use-inbox-badge";
import { INBOX_ITEM_HREF } from "@/lib/inbox-badge";
import { runWhenIdle } from "@/lib/idle";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { lazyPanel } from "@/lib/lazy-panel";
import { announceScope } from "@/lib/ui/use-nav-role";
import { SCOPE_COOKIE, SCOPE_COOKIE_MAX_AGE } from "@/lib/ui/scope";

// Radix Dialog gövdeleri (menü çekmecesi, "+ Yeni" sayfası) yalnız mobil/tablette gerekir: masaüstü kabuk paketine
// girmez; küçük ekranda boşta önceden iner, ilk dokunuşta (hover/odak/dokunma ısıtması dahil) açık gelir.
const drawerPanel = lazyPanel(() => import("@/components/app/app-sidebar-drawer").then((m) => m.AppSidebarDrawer));
const newSheetPanel = lazyPanel(() => import("@/components/app/mobile-new-sheet-dialog").then((m) => m.MobileNewSheet));
/** Tailwind `lg` altı (çekmece kırılımı): yalnız burada boşta önceden yükleme yapılır. */
const SMALL_SCREEN_QUERY = "(max-width: 1023.98px)";

type NavHub = ShellHub<LucideIcon>;
type HubPage = ShellPage<LucideIcon>;

/** Yan menünün sabit ikonları (ikon sözlüğü `src/lib/icons.ts`; sunucuda çözülür, bkz. nav-shell-server). */
export type SidebarIcons = { portal: ShellIcon; tools: ShellIcon; modules: ShellIcon };

function isLocked(href: string, lockedHrefs: readonly string[]) {
  return isHrefLocked(href, lockedHrefs);
}

/** Bir merkezdeki bekleyen işler (geciken görev, bekleyen onay): merkez kapalıyken de gözden kaçmaz. */
function hubBadge(hub: NavHub, badges: readonly NavBadge[]): { count: number; href: string; label: string; tone: NavBadge["tone"] } | null {
  const own = badges.filter((b) => hub.pages.some((p) => p.href === b.itemHref || p.itemHref === b.itemHref));
  const first = own[0];
  if (!first) return null;
  const count = own.reduce((n, b) => n + b.count, 0);
  // Tek rozet kendi süzgeçli hedefine (ör. geciken görevler), birden çoksa merkezin girişine gider.
  return {
    count,
    href: own.length === 1 ? first.href : hub.href,
    label: own.map((b) => `${b.count} ${b.label}`).join(", "),
    tone: own.some((b) => b.tone === "danger") ? "danger" : "warn",
  };
}

/**
 * Yan menü (masaüstü kenar çubuğu + mobil çekmece) ve mobil alt çubuk.
 *
 * Yapı (2026-10, "Google sadeliği"): menü ROL BAZLI MERKEZLERDEN oluşur (ofis 6, danışman 5, muhasebe 4, çağrı 4 satır;
 * bkz. src/lib/nav-roles.ts). Merkezin sayfaları sayfanın üstündeki TEK sekme şeridindedir (SectionTabs), yan menüde
 * alt liste yoktur. Altta sabit: Ayarlar, Abonelik, Yardım, "Araçlar" (kapalı grup) ve "Menüyü düzenle".
 * Mobil alt çubuk rol bazlıdır (en çok 5 yuva, "+ Yeni" eylem sayfası, "Menü" çekmecesi).
 */
export function AppSidebar({
  officeName,
  plan,
  trial,
  trialDaysLeft = null,
  navs,
  actions,
  icons,
  lockedHrefs = [],
  badges: serverBadges = [],
  usage = [],
  canUpgrade = false,
  vitrinHref = null,
  storageScope,
  role = null,
  simple = false,
  scopeCookie = null,
}: {
  officeName: string;
  plan: string;
  trial: boolean;
  /** Deneme ofisinde kalan gün (tenants.trial_ends_at); bilinmiyorsa null. */
  trialDaysLeft?: number | null;
  /**
   * Rolün menü düzenleri (sunucuda etkin izin + ofisin kapattığı/kişisel gizlenen modüller süzülmüş;
   * bkz. app/layout.tsx `buildShellNavSet`). Katalog, rol düzeni ve ikon sözlüğü istemci paketine girmez.
   */
  navs: ShellNavSet;
  /** "create" yetkili, paket kilidi ve kapalı modül süzgecinden geçmiş hızlı eylemler (`buildShellActions`). */
  actions: ShellAction[];
  icons: SidebarIcons;
  /** Pakete dahil olmayan sayfalar: menüde kilit simgesi, tıklayınca yükseltme sayfası. */
  lockedHrefs?: string[];
  /** Gerçek veriden sayı rozetleri (geciken görev, bekleyen onay). */
  badges?: NavBadge[];
  /** Paket limitine karşı gerçek kullanım; limitsiz kalemler gelmez. */
  usage?: PlanUsageRow[];
  canUpgrade?: boolean;
  vitrinHref?: string | null;
  /** `${tenantId}:${userId}` — menü durum tercihlerinin yerel anahtarı. */
  storageScope?: string;
  /** Etkin rol: merkez yapısını ve mobil alt çubuğu belirler (yetkiyi değiştirmez). */
  role?: string | null;
  /** Sade görünüm (varsayılan): "Araçlar" kapalı gelir; kapalıysa (Tüm sayfalar görünür) açık gelir. */
  simple?: boolean;
  /** Kapsam çerezi (es_scope): yönetim rolü "Benim işlerim" seçtiyse menü kişisel düzene geçer (yalnız görünüm). */
  scopeCookie?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { nav, extra, navRole, personal } = useShellNav(navs, role, scopeCookie);
  // Gelen kutusu "Yanıt bekliyor" rozeti (COM-01): menüde gelen kutusu varsa boşta sorulur; kabuk akışını bekletmez.
  const inboxBadge = useInboxBadge(nav.hubs.some((h) => h.pages.some((p) => p.href === INBOX_ITEM_HREF)));
  const badges = useMemo(() => (inboxBadge ? [...serverBadges, inboxBadge] : serverBadges), [serverBadges, inboxBadge]);
  const VitrinIcon = glyph(icons.portal);
  const ToolsIcon = glyph(icons.tools);
  const ModulesIcon = glyph(icons.modules);
  const backToOffice = () => {
    document.cookie = `${SCOPE_COOKIE}=ofis; path=/app; max-age=${SCOPE_COOKIE_MAX_AGE}; samesite=lax`;
    announceScope("ofis");
    router.push("/app?kapsam=ofis");
  };
  // Prefetch: next/link varsayılanı (görünür alanda + hover) yeterli; elle router.prefetch yağmuru kaldırıldı.
  // Çekmece durumu üst çubuktaki hamburger (MobileMenuTrigger) ile ortak bağlamda; alt çubuktaki "Menü" de aynı yolu kullanır.
  const { open, setOpen, requestOpen: openDrawer, openerRef: drawerOpenerRef, register: registerMenu } = useMobileMenu();
  const [newOpen, setNewOpen] = useState(false);
  const { Panel: Drawer, open: mountDrawer, warm: warmDrawer } = useDeferredPanel(drawerPanel, { idle: false });
  const { Panel: NewSheet, open: mountNewSheet, warm: warmNewSheet } = useDeferredPanel(newSheetPanel, { idle: false });
  // Dokunma örtüleri (B032): pointerdown ANINDA hafif karartma + panel silüeti; Radix gövdesi tıklamadan sonra bağlanır.
  const { ref: drawerVeilRef, show: showDrawerVeil, hide: hideDrawerVeil, afterPaint: afterDrawerVeil } = useTapVeil(open);
  const { ref: sheetVeilRef, show: showSheetVeil, hide: hideSheetVeil, afterPaint: afterSheetVeil } = useTapVeil(newOpen);
  useEffect(
    () =>
      registerMenu({
        mount: mountDrawer,
        warm: warmDrawer,
        press: showDrawerVeil,
        open: () =>
          afterDrawerVeil(() => {
            mountDrawer();
            setOpen(true);
          }),
      }),
    [registerMenu, mountDrawer, warmDrawer, showDrawerVeil, afterDrawerVeil, setOpen],
  );
  // Örtüyle açılan diyalog kapanınca işaret kalkar (sonraki açılışlarda Radix örtüsü yine kendi animasyonuyla gelir).
  useEffect(() => {
    if (!open && !newOpen) clearTapVeilAttr();
  }, [open, newOpen]);
  useEffect(() => {
    if (!window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    return runWhenIdle(() => {
      drawerPanel.preload();
      newSheetPanel.preload();
    });
  }, []);
  const openNewSheet = () =>
    afterSheetVeil(() => {
      mountNewSheet();
      setNewOpen(true);
    });

  // Ofisin kapattığı modüller menüden çıkar (veri silinmez): süzgeç sunucuda (`navs`) uygulanmıştır.
  const active = resolveActiveHubIn(pathname, nav, extra);
  const activeHubId = active.hub?.id ?? null;

  const closedStore = getHrefStore("closed", storageScope);
  // "closed" deposu menü DURUM kimliklerini tutar: araclar-degisti (Araçlar grubunun varsayılandan ters durumu) ve
  // ck-<ilk merkez> (mobil çekmecede kullanıcının kapattığı grup; try/catch korumalı localStorage).
  const stateIds = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggleState = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const toolsOpen = active.inTools || (!simple !== stateIds.includes("araclar-degisti"));
  // Sade düzen (plan 2.2): ana satırların altında TEK "Daha fazla" bölümü (katlanan merkezler + Araçlar + Menüyü düzenle).
  // Kapalı gelir; etkin sayfa içindeyse açıktır; kullanıcının açtığı hatırlanır.
  const sadeMenu = nav.simple;
  const moreHasActive = (nav.more.some((h) => h.id === activeHubId) && !active.inDock) || active.inTools;
  const moreOpen = moreHasActive || stateIds.includes("daha-fazla-acik");

  // Boşta ısıtılan hedefler: rolün menü merkezleri ve alt sabit satırlar (menü sırası; etkin sayfa ve kilitliler atlanır).
  const idleTargets = [...nav.hubs, ...nav.more, ...nav.dock].map((h) => h.href).filter((h) => h !== active.pageHref && !isLocked(h, lockedHrefs));
  // Kademe `hubs`: ilk 3 merkez TAM, kalanı yalnız ucuz rota ağacı (hedefin kendi iskeleti anında gelir); kardeş sekmelerden SONRA.
  useIdlePrefetch(idleTargets, 14, { tier: "hubs" });

  // Mobil çekmece: ardışık aynı grup başlıklı merkezler tek bölümde toplanır (akordeon). Gruplar varsayılan AÇIK gelir
  // (sık işler tek dokunuşta: ör. Komisyon); kullanıcının kapattıkları hatırlanır, etkin merkezin grubu hep açık.
  const hubSections = useMemo(() => {
    const out: { key: string; group: string | null; hubs: NavHub[] }[] = [];
    for (const hub of nav.hubs) {
      const last = out[out.length - 1];
      if (last && last.group === (hub.group ?? null)) last.hubs.push(hub);
      else out.push({ key: `g${out.length}`, group: hub.group ?? null, hubs: [hub] });
    }
    return out;
  }, [nav.hubs]);
  const drawerGroupId = (hubs: readonly NavHub[]) => `ck-${hubs[0]?.id ?? "grup"}`.slice(0, 32);

  // "Son açılanlar": yalnız sayfa yolları, yerel ve kullanıcıya özel (localStorage, try/catch); menüdeki yetkili sayfalarla süzülür.
  const recentStore = getHrefStore("recent", storageScope);
  const recents = useSyncExternalStore(recentStore.subscribe, recentStore.read, recentStore.getServerSnapshot);
  const pageIndex = useMemo(() => {
    const m = new Map<string, HubPage>();
    for (const p of [...nav.hubs, ...nav.more, ...nav.dock].flatMap((h) => h.pages).concat(nav.tools)) if (!m.has(p.href)) m.set(p.href, p);
    return m;
  }, [nav]);
  const currentPage = active.pageHref;
  useEffect(() => {
    if (!currentPage || currentPage === "/app" || !pageIndex.has(currentPage)) return;
    const cur = recentStore.read();
    if (cur[0] !== currentPage) recentStore.write(pushRecent(cur, currentPage));
  }, [currentPage, pageIndex, recentStore]);
  const recentRows = recents
    .filter((h) => h !== currentPage && h !== "/app" && pageIndex.has(h))
    .slice(0, 3)
    .map((h) => pageIndex.get(h)!);

  const allActions = useMemo(() => actions.map((a) => ({ ...a, icon: glyph(a.icon) })), [actions]);
  const actionsFor = (hub: NavHub) => {
    const owned = hub.pages.map((p) => p.href).filter((h) => h !== "/app");
    return allActions.filter((a) => owned.some((h) => a.href === h || a.href.startsWith(`${h}/`)));
  };

  const rowClass = (isActive: boolean, pad: string) =>
    `nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors lg:min-h-9 touch:min-h-11 ${pad} ${
      isActive ? "nav-pill font-semibold text-white" : "text-white/80 hover:bg-white/6 hover:text-white"
    }`;

  /** Ana satır / alt sabit satır: tek bağlantı, ikon + ad (+ rozet). */
  const renderHub = (hub: NavHub, opts: { dock?: boolean }) => {
    const isActive = hub.id === activeHubId && active.inDock === Boolean(opts.dock);
    const badge = hubBadge(hub, badges);
    const locked = isLocked(hub.href, lockedHrefs);
    const tip = hub.pages.length > 1 ? `${hub.label}: ${hub.pages.slice(0, 5).map((p) => p.label).join(", ")}` : (hub.pages[0]?.description ?? hub.label);
    return (
      <div key={`${opts.dock ? "dock" : "hub"}-${hub.id}`} className="nav-item group relative">
        <Link
          href={hub.href}
          data-nav-link
          data-nav-active={isActive ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          title={tip}
          onClick={() => setOpen(false)}
          className={rowClass(isActive, badge ? "pr-12" : "pr-3")}
        >
          <hub.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-white" : "text-white/65 group-hover:text-white"}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{hub.label}</span>
          {locked ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
        </Link>
        {badge ? (
          <Link
            href={badge.href}
            onClick={() => setOpen(false)}
            aria-label={badge.label}
            title={badge.label}
            style={{ right: "0.5rem" }}
            className={`nav-badge absolute top-1/2 -translate-y-1/2 ${badge.tone === "danger" ? "is-danger" : "is-warn"}`}
          >
            {badge.count > 9 ? "9+" : badge.count}
          </Link>
        ) : null}
      </div>
    );
  };

  const renderTool = (page: HubPage) => {
    const isActive = active.inTools && active.pageHref === page.href;
    return (
      <Link
        key={page.href}
        href={page.href}
        data-nav-link
        data-nav-active={isActive ? "true" : undefined}
        aria-current={isActive ? "page" : undefined}
        title={page.description ? `${page.label} — ${page.description}` : page.label}
        onClick={() => setOpen(false)}
        className={rowClass(isActive, "pr-3")}
      >
        <page.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-white" : "text-white/65"}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{page.label}</span>
        {isLocked(page.href, lockedHrefs) ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
      </Link>
    );
  };

  const hubFlyoutItems = (hub: NavHub) =>
    hub.pages.map((p) => ({ href: p.href, label: p.label, icon: p.icon, active: p.href === active.pageHref && hub.id === activeHubId }));

  const renderTools = () =>
    nav.tools.length > 0 ? (
      <>
        <button
          type="button"
          onClick={() => toggleState("araclar-degisti")}
          aria-expanded={toolsOpen}
          aria-controls="sb-araclar"
          title="Değerleme, hesaplayıcı, yardımcı ve diğer araçlar"
          className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white lg:min-h-9 touch:min-h-11"
        >
          <ToolsIcon className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Araçlar</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${toolsOpen ? "" : "-rotate-90"}`} aria-hidden />
        </button>
        {toolsOpen ? (
          <div id="sb-araclar" className="ml-4 space-y-0.5 border-l border-white/10 pl-2">
            {nav.tools.map(renderTool)}
          </div>
        ) : null}
      </>
    ) : null;
  // Menüyü düzenle: kullanılmayan modülleri tek tıkla aç/kapat. Ofis sahibi/genel müdür ofis genelini, diğerleri
  // yalnız kendi menüsünü düzenler (yeni sayfa yok; mevcut ayar ekranlarına gider).
  const renderEditMenu = () => (
    <Link
      href={role === "owner" || role === "gm" ? "/app/ayarlar/moduller" : "/app/hesabim?sekme=gorunum"}
      onClick={() => setOpen(false)}
      title="Kullanmadığınız modülleri tek tıkla gizleyin veya açın"
      className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/65 transition-colors hover:bg-white/8 hover:text-white lg:min-h-9"
    >
      <ModulesIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span>Menüyü düzenle</span>
    </Link>
  );

  /** Sade düzenin "Daha fazla" bölümü: katlanan merkezler, Araçlar ve Menüyü düzenle (hiçbir özellik silinmez). */
  const moreSection = sadeMenu ? (
    <div className="mt-1">
      <DrawerGroup
        id="daha-fazla"
        title="Daha fazla"
        count={nav.more.length + nav.tools.length}
        expanded={moreOpen}
        locked={moreHasActive}
        badge={nav.more.reduce((n, h) => n + (hubBadge(h, badges)?.count ?? 0), 0)}
        onToggle={() => toggleState("daha-fazla-acik")}
      >
        {nav.more.map((hub) => renderHub(hub, {}))}
        {renderTools()}
        {renderEditMenu()}
      </DrawerGroup>
    </div>
  ) : null;

  const renderContent = (variant: "desktop" | "drawer") => (
    <>
      <div className="sb-head flex min-h-11 shrink-0 items-center gap-3 border-b border-white/8 px-4">
        <Brand variant="mark" tone="dark" height={32} alt="" className="rounded-[var(--radius-card)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-base font-extrabold leading-5 text-white">EmlakSoft</p>
          {/* Sözlük (plan 2.6): "Ofis konsolu" yerine ofisin kendi adı. */}
          <p className="truncate text-xs font-bold uppercase tracking-[0.12em] text-[var(--gold-300)]" title={officeName}>{officeName}</p>
        </div>
        <SidebarCollapseButton />
      </div>
      {personal ? (
        <button
          type="button"
          onClick={backToOffice}
          className="focus-ring sb-label mx-3 mt-2 min-h-11 rounded-[var(--radius-control)] border border-white/15 px-3 text-left text-xs font-semibold text-white/80 transition hover:bg-white/10"
        >
          Ofis görünümüne dön
        </button>
      ) : null}

      <MenuSearchButton onActivate={() => setOpen(false)} />

      <NavScroller label="Uygulama ana menüsü" className={`sb-pad flex-1 overscroll-contain px-3${variant === "drawer" ? " nav-scroll-drawer" : ""}`} innerClassName="pb-3">
        <div className="sb-expanded">
          {variant === "drawer" ? (
            <>
              {recentRows.length > 0 ? (
                <div className="pt-1">
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-white/70">Son açılanlar</p>
                  <div className="space-y-0.5">
                    {recentRows.map((r) => (
                      <Link
                        key={r.href}
                        href={r.href}
                        data-nav-link
                        onClick={() => setOpen(false)}
                        className="nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 pr-3 text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white"
                      >
                        <r.icon className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              {hubSections.map((sec) => {
                const hasActive = sec.hubs.some((h) => h.id === activeHubId) && !active.inDock && !active.inTools;
                const sectionBadge = sec.hubs.reduce((n, h) => n + (hubBadge(h, badges)?.count ?? 0), 0);
                if (!sec.group) {
                  return (
                    <div key={sec.key} className="space-y-0.5 pt-1">
                      {sec.hubs.map((hub) => renderHub(hub, {}))}
                    </div>
                  );
                }
                return (
                  <DrawerGroup
                    key={sec.key}
                    id={sec.key}
                    title={sec.group}
                    count={sec.hubs.length}
                    expanded={hasActive || !stateIds.includes(drawerGroupId(sec.hubs))}
                    locked={hasActive}
                    badge={sectionBadge}
                    onToggle={() => toggleState(drawerGroupId(sec.hubs))}
                  >
                    {sec.hubs.map((hub) => renderHub(hub, {}))}
                  </DrawerGroup>
                );
              })}
            </>
          ) : (
            <div className="space-y-0.5 pt-1">
              {nav.hubs.map((hub, i) => (
                <Fragment key={hub.id}>
                  {hub.group && hub.group !== nav.hubs[i - 1]?.group ? (
                    <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-white/45 first:pt-1">{hub.group}</p>
                  ) : null}
                  {renderHub(hub, {})}
                </Fragment>
              ))}
            </div>
          )}

          {moreSection}

          {/* Alt sabit: Ayarlar, Abonelik, Yardım (satır bütçesine sayılmaz) + Araçlar (kapalı grup) + Menüyü düzenle
              (sade düzende Araçlar ve Menüyü düzenle "Daha fazla" içindedir). Mobil çekmecede Ayarlar/Abonelik/Yardım
              kaydırma alanının dışında, yapışkan alt şeritte durur. */}
          {variant === "desktop" || !sadeMenu ? (
            <div className="mt-3 space-y-0.5 border-t border-white/10 pt-3">
              {variant === "desktop" ? nav.dock.map((hub) => renderHub(hub, { dock: true })) : null}
              {sadeMenu ? null : (
                <>
                  {renderTools()}
                  {renderEditMenu()}
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* İkon modu (64px): merkez başına tek ikon; hover/odakta sağda sayfa listesi + hızlı eylemler. */}
        {variant === "desktop" ? (
        <div className="sb-rail space-y-1 pt-3">
          {[...nav.hubs, ...nav.more].map((hub) => {
            const isActive = hub.id === activeHubId && !active.inDock;
            const badge = hubBadge(hub, badges);
            return (
              <NavFlyout
                key={hub.id}
                enabled={variant === "desktop"}
                title={hub.label}
                href={hub.href}
                items={hub.pages.length > 1 ? hubFlyoutItems(hub) : []}
                actions={actionsFor(hub)}
              >
                <Link
                  href={hub.href}
                  data-nav-link
                  data-nav-active={isActive ? "true" : undefined}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={badge ? `${hub.label}, ${badge.label}` : hub.label}
                  className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    isActive ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <hub.icon className="h-[18px] w-[18px]" aria-hidden />
                  {badge ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-400" aria-hidden /> : null}
                </Link>
              </NavFlyout>
            );
          })}
          <div className="my-1 border-t border-white/10" aria-hidden />
          {nav.dock.map((hub) => {
            const isActive = hub.id === activeHubId && active.inDock;
            return (
              <NavFlyout key={hub.id} enabled={variant === "desktop"} title={hub.label} href={hub.href} items={hub.pages.length > 1 ? hubFlyoutItems(hub) : []}>
                <Link
                  href={hub.href}
                  data-nav-link
                  data-nav-active={isActive ? "true" : undefined}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={hub.label}
                  className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    isActive ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <hub.icon className="h-[18px] w-[18px]" aria-hidden />
                </Link>
              </NavFlyout>
            );
          })}
          {nav.tools.length > 0 ? (
            <NavFlyout
              enabled={variant === "desktop"}
              title="Araçlar"
              items={nav.tools.map((t) => ({ href: t.href, label: t.label, icon: t.icon, active: active.inTools && active.pageHref === t.href }))}
            >
              <Link
                href={nav.tools[0]!.href}
                data-nav-link
                data-nav-active={active.inTools ? "true" : undefined}
                aria-current={active.inTools ? "true" : undefined}
                aria-label="Araçlar"
                className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                  active.inTools ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                }`}
              >
                <ToolsIcon className="h-[18px] w-[18px]" aria-hidden />
              </Link>
            </NavFlyout>
          ) : null}
        </div>
        ) : null}
      </NavScroller>

      {/* Mobil çekmece: Ayarlar/Abonelik/Yardım yapışkan alt şeritte, tek satır kare düğmeler (kaydırmadan hep erişilir). */}
      {variant === "drawer" && nav.dock.length > 0 ? (
        <div className="grid shrink-0 gap-1 border-t border-white/10 px-3 py-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(nav.dock.length, 4)}, minmax(0, 1fr))` }}>
          {nav.dock.map((hub) => {
            const isActive = hub.id === activeHubId && active.inDock;
            return (
              <Link
                key={hub.id}
                href={hub.href}
                data-nav-link
                aria-current={isActive ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`focus-ring flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-1 text-center text-xs font-semibold leading-tight transition-colors ${
                  isActive ? "nav-pill text-white" : "text-white/75 hover:bg-white/6 hover:text-white"
                }`}
              >
                <hub.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="max-w-full truncate">{hub.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Alt şerit TEK satır: kompakt ofis durumu çipi (paket + deneme günü / en dolu kullanım; tıklayınca panel)
          ve vitrin kısayolu. Eski büyük "Ofis durumu" kartı kaldırıldı (kullanıcı geri bildirimi: gereksiz büyük). */}
      <div className="sb-pad sb-foot flex shrink-0 items-center gap-1 border-t border-white/8 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <OfficeStatusChip
            officeName={officeName}
            plan={plan}
            trial={trial}
            trialDaysLeft={trialDaysLeft}
            usage={usage}
            canUpgrade={canUpgrade}
            onNavigate={() => setOpen(false)}
          />
        </div>
        {vitrinHref ? (
          <a
            href={vitrinHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Ofis vitrinini yeni sekmede aç"
            aria-label="Vitrini görüntüle (yeni sekme)"
            className="sb-label focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-white/70 transition-colors hover:bg-white/8 hover:text-white touch:h-11 touch:w-11"
          >
            <VitrinIcon className="h-[18px] w-[18px]" aria-hidden />
          </a>
        ) : null}
      </div>
    </>
  );

  // Mobil alt çubuk: rol bazlı en çok 5 yuva (nav-roles `mobile`): merkez bağlantıları, "+ Yeni" eylem sayfası, "Menü"
  // çekmecesi. Çekmece masaüstüyle AYNI yapıdır (6 satırlık merkez listesi). Yetkisiz/kapalı merkez yuvası çıkmaz.
  const newActions = useMemo(() => mobileNewActions(navRole, allActions), [navRole, allActions]);
  type Slot = { kind: "hub"; hub: NavHub } | { kind: "new" } | { kind: "menu" };
  const slots = nav.mobile.flatMap<Slot>((slot) => {
    if (slot === "menu") return [{ kind: "menu" }];
    if (slot === "new") return newActions.length > 0 ? [{ kind: "new" }] : [];
    const hub = nav.hubs.find((h) => h.id === slot);
    return hub ? [{ kind: "hub", hub }] : [];
  });
  // Alt çubukta kendi yuvası olan merkezin rozeti yuvada görünür; "Menü" yalnız çekmecedeki (yuvası olmayan) işleri sayar.
  const slotHubs = slots.flatMap((s) => (s.kind === "hub" ? [s.hub] : []));
  const totalBadges = badges
    .filter((b) => !slotHubs.some((h) => h.pages.some((p) => p.href === b.itemHref || p.itemHref === b.itemHref)))
    .reduce((n, b) => n + b.count, 0);
  const slotClass = "focus-ring flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs font-semibold leading-tight transition";

  return (
    <>
      {/* Çentik (B135): iOS PWA'da kabuk durum çubuğu bandının altından başlar; kenar çubuğu da bandın altına yapışır. */}
      <aside className="shell-aside sb-surface sticky top-[env(safe-area-inset-top)] hidden h-[calc(100vh-env(safe-area-inset-top))] shrink-0 flex-col self-start overflow-hidden lg:flex">
        {renderContent("desktop")}
      </aside>
      {Drawer ? (
        <Suspense fallback={null}>
          <Drawer
            open={open}
            onOpenChange={setOpen}
            responsiveClassName="lg:hidden"
            render={() => renderContent("drawer")}
            restoreFocusTo={() => drawerOpenerRef.current}
            onShown={hideDrawerVeil}
          />
        </Suspense>
      ) : null}
      {NewSheet ? (
        <Suspense fallback={null}>
          {/* MobileNewSheet: "+ Yeni" eylem sayfası (ilk dokunuşta yüklenen Radix Dialog gövdesi) */}
          <NewSheet open={newOpen} onOpenChange={setNewOpen} actions={newActions} onShown={hideSheetVeil} />
        </Suspense>
      ) : null}
      {/* Dokunma örtüleri (B032): `hidden` durur, pointerdown'da React render'ı olmadan görünür olur; gerçek Radix gövdesi
          aynı konum ve görünümle bağlandığı karede kalkar. Etkileşimsiz (aria-hidden, odak almaz). Karartma
          bulanık DEĞİL: tam ekran bulanıklık zayıf CPU'da ilk karenin boyamasını geciktirir (cam bütçesi). */}
      <div ref={drawerVeilRef} hidden aria-hidden="true" className={`${TAP_VEIL_CLASS} lg:hidden`}>
        <div className="fixed inset-0 z-50 bg-ink-950/60" />
        <div className="sb-surface fixed inset-y-0 left-0 z-50 h-dvh w-[min(88vw,300px)] overflow-hidden pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-[var(--shadow-lg)]">
          <div className="flex min-h-11 items-center gap-3 border-b border-white/8 px-4">
            <span className="h-8 w-8 rounded-[var(--radius-card)] bg-white/10" />
            <span className="font-display text-base font-extrabold text-white">EmlakSoft</span>
          </div>
          {/* Boş çekmece yerine iskelet satırlar: gerçek menü bağlanana dek menünün yerleşimi görünür (C01). */}
          <div className="space-y-1 px-3 pt-3">
            {nav.hubs.map((hub) => (
              <div key={hub.id} className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/70">
                <hub.icon className="h-[18px] w-[18px] shrink-0 text-white/45" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{hub.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {newActions.length > 0 ? (
        <div ref={sheetVeilRef} hidden aria-hidden="true" className={`${TAP_VEIL_CLASS} lg:hidden`}>
          <div className="fixed inset-0 z-50 bg-ink-950/60" />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-hidden rounded-t-[var(--radius-panel)] border-t border-line bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)]">
            <div className="px-5 pb-2 pt-4">
              <p className="font-display text-lg font-bold text-ink-950">Ne eklemek istiyorsunuz?</p>
              <p className="text-sm text-text-muted">Bir seçim yapın, form açılsın.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-2">
              {splitNewActions(newActions, sadeMenu).primary.map((a) => (
                <div key={a.href} className={SHEET_ROW_CLASS}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                    <a.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <nav
        aria-label="Mobil hızlı gezinme"
        // Cam bütçesi: alt çubuk opak (cam yalnız sabit ÜST çubukta; mobil kaydırmada bulanıklık pahalı).
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
          {slots.map((slot) => {
            if (slot.kind === "new") {
              return (
                <button
                  key="new"
                  type="button"
                  {...pressOpenHandlers({
                    open: openNewSheet,
                    press: () => {
                      warmNewSheet();
                      showSheetVeil();
                    },
                    cancel: hideSheetVeil,
                  })}
                  onPointerEnter={warmNewSheet}
                  onFocus={warmNewSheet}
                  onTouchStart={warmNewSheet}
                  aria-haspopup="dialog"
                  aria-label="Hızlı ekle menüsü"
                  className={`${slotClass} text-brand-700`}
                >
                  <span className="grid h-7 w-11 place-items-center rounded-full bg-brand-600 text-white">
                    <Plus className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  Yeni
                </button>
              );
            }
            if (slot.kind === "menu") {
              return (
                <button
                    key="menu"
                    type="button"
                    {...pressOpenHandlers({
                      open: openDrawer,
                      press: () => {
                        warmDrawer();
                        showDrawerVeil();
                      },
                      cancel: hideDrawerVeil,
                    })}
                    onPointerEnter={warmDrawer}
                    onFocus={warmDrawer}
                    onTouchStart={warmDrawer}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-controls="app-mobile-navigation"
                    aria-label={totalBadges > 0 ? `Menü: tüm sayfalar, ${totalBadges} bekleyen iş` : "Menü: tüm sayfalar"}
                    className={`${slotClass} text-text-faint hover:text-ink-950`}
                  >
                    <span className="relative grid h-7 w-11 place-items-center rounded-full">
                      <Menu className="h-[18px] w-[18px]" aria-hidden />
                      {/* Menü rozeti sayı değil NOKTA (plan 2.2): çekmecedeki bekleyen iş var mı, yalnız onu söyler. */}
                      {totalBadges > 0 ? <span className="absolute right-1 top-0 h-2.5 w-2.5 rounded-full bg-danger-500 ring-2 ring-surface" aria-hidden /> : null}
                    </span>
                    Menü
                  </button>
              );
            }
            const { hub } = slot;
            // Etkin sekme = etkin merkez (alt sayfalar dahil; nav-config ile aynı çözümleme).
            const isActive = hub.id === activeHubId && !active.inDock;
            const slotBadge = hubBadge(hub, badges);
            return (
              <Link
                key={hub.id}
                href={hub.href}
                aria-current={isActive ? "page" : undefined}
                aria-label={slotBadge ? `${hub.short ?? hub.label}, ${slotBadge.label}` : undefined}
                onClick={() => setOpen(false)}
                className={`${slotClass} ${isActive ? "text-brand-600" : "text-text-faint hover:text-ink-950"}`}
              >
                <span className={`relative grid h-7 w-11 place-items-center rounded-full transition ${isActive ? "bg-brand-600/12" : ""}`}>
                  <hub.icon className="h-[18px] w-[18px]" aria-hidden />
                  {slotBadge ? (
                    <span className={`nav-badge absolute -right-0.5 -top-1 ${slotBadge.tone === "danger" ? "is-danger" : "is-warn"}`} aria-hidden>
                      {slotBadge.count > 9 ? "9+" : slotBadge.count}
                    </span>
                  ) : null}
                </span>
                {hub.short ?? hub.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
