"use client";

import Link from "@/components/ui/smart-link";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { Brand } from "@/components/brand/brand";
import { usePathname } from "next/navigation";
import { Fragment, Suspense, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Crown, Lock, Menu, Plus, type LucideIcon } from "lucide-react";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import { getHrefStore, pushRecent } from "@/lib/nav-memory";
import { resolveActiveHubIn, type ShellAction, type ShellHub, type ShellIcon, type ShellNavSet, type ShellPage } from "@/lib/nav-shell";
import { glyph, useShellNav } from "@/components/app/nav-glyph";
import { useMobileMenu } from "@/components/app/mobile-menu-trigger";
import { mobileNewActions, SHEET_ROW_CLASS, splitNewActions } from "@/components/app/mobile-new-sheet";
import { clearTapVeilAttr, pressOpenHandlers, TAP_VEIL_CLASS, useTapVeil } from "@/components/app/tap-veil";
import type { NavCounts } from "@/lib/app-shell/nav-counts";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
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

/** Merkezin nötr sayı rozeti (canlı ilan, müşteri, bugünkü randevu, açık görev, bekleyen teklif): ilk sayılı sayfası. */
function hubCount(hub: NavHub, counts: NavCounts): { count: number; href: string } | null {
  for (const p of hub.pages) {
    const n = counts.counts[p.href];
    if (n) return { count: n, href: p.href };
  }
  return null;
}

/**
 * Satır sağ ucu: uyarı rozeti (geciken görev, bekleyen onay) varsa o; yoksa nötr sayı hapı (sayı sözü kendi sınırında
 * çözülür, kabuk beklemez) ya da durum noktası (Sahibinden Takibi eşitlemesi). Hiçbiri yoksa boş.
 */
function RowCount({ hub, counts, onNavigate }: { hub: NavHub; counts: Promise<NavCounts>; onNavigate: () => void }) {
  const data = use(counts);
  const dot = hub.pages.map((p) => data.dots[p.href]).find(Boolean);
  if (dot) {
    return (
      <span
        className={`sb-dot ${dot === "ok" ? "is-ok" : "is-warn"}`}
        role="img"
        aria-label={dot === "ok" ? "Eşitleme güncel" : "Eşitleme 3 günden eski"}
        title={dot === "ok" ? "Eşitleme güncel" : "Son yeni ilan 3 günden eski"}
      />
    );
  }
  const c = hubCount(hub, data);
  if (!c) return null;
  return (
    <Link href={c.href} onClick={onNavigate} className="sb-count focus-ring" aria-label={`${hub.label}: ${c.count}`} title={`${hub.label}: ${c.count}`}>
      {c.count > 999 ? "999+" : c.count}
    </Link>
  );
}

/**
 * Paketim kartı — KOMPAKT tek satır (sahip geri bildirimi 2026-10-16): taç ikonu + paket adı + "8/15 kullanıcı · 247 gün"
 * + ince doluluk çizgisi; "Paketini yükselt" yalnız ofis sahibi/genel müdürde küçük altın ikon düğmesi. Daraltılmış
 * menüde yalnız ikon (ipucu metniyle). Menüyü daraltan/özet gösteren ikinci bir alt şerit YOKTUR.
 */
function PackageCard({
  plan,
  trialDaysLeft,
  usage,
  canUpgrade,
  billingHref,
  onNavigate,
}: {
  plan: string;
  trialDaysLeft: number | null;
  usage: readonly PlanUsageRow[];
  canUpgrade: boolean;
  billingHref: string | null;
  onNavigate: () => void;
}) {
  const seats = usage.find((u) => u.key === "seats") ?? null;
  const ratio = seats && seats.limit > 0 ? Math.min(1, seats.used / seats.limit) : null;
  const tone = ratio == null ? "ok" : ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok";
  const meta = [seats ? `${seats.used}/${seats.limit} kullanıcı` : null, trialDaysLeft != null ? `${trialDaysLeft} gün kaldı` : null].filter(Boolean).join(" · ");
  const tip = `Paketim: ${plan}${meta ? ` · ${meta}` : ""}`;
  const body = (
    <>
      <span className="sb-pkg-ico" aria-hidden>
        <Crown className="h-4 w-4" />
      </span>
      <span className="sb-label min-w-0 flex-1">
        <span className="block truncate text-sm font-bold leading-5 text-white">{plan}</span>
        {meta ? <span className="num block truncate text-xs leading-4 text-white/65">{meta}</span> : null}
        {ratio != null ? (
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-white/10" aria-hidden>
            <span className={`sb-pkg-bar is-${tone} block h-full rounded-full`} style={{ width: `${Math.max(ratio * 100, 4)}%` }} />
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <div className="sb-pkg">
      {billingHref ? (
        <Link href={billingHref} onClick={onNavigate} title={tip} aria-label={`${tip}. Abonelik ayrıntısını aç`} className="sb-pkg-main focus-ring">
          {body}
        </Link>
      ) : (
        <div className="sb-pkg-main" title={tip}>
          {body}
        </div>
      )}
      {canUpgrade && billingHref ? (
        <Link
          href={`${billingHref}?sekme=paketler`}
          onClick={onNavigate}
          title="Paketini yükselt"
          aria-label="Paketini yükselt"
          className="sb-upgrade sb-label focus-ring press grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] touch:h-11 touch:w-11"
        >
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Yan menü (masaüstü kenar çubuğu + mobil çekmece) ve mobil alt çubuk — KURUMSAL REFERANS düzeni (sahip kararı
 * 2026-10-16, tek görünüm): logo bloğu + daraltma düğmesi → ofis kartı (logo, ad, şehir, paket rozeti) → DÜZ satırlar
 * (ikon + ad + sayı rozeti / durum noktası; `sub` merkezlerde satır içinde açılan alt liste, ok düğmesiyle) → "Yönetim"
 * başlığı → Yardım, Araçlar, Menüyü düzenle → Paketim kartı. Etkin satır altın degrade hap. Merkezin kardeş sayfaları
 * sayfanın üstündeki TEK sekme şeridindedir (SectionTabs). Mobil alt çubuk rol bazlıdır (en çok 5 yuva, "+ Yeni",
 * "Menü" çekmecesi); çekmece masaüstüyle AYNI içeriktir.
 */
export function AppSidebar({
  officeName,
  officeCard = null,
  plan,
  trial,
  trialDaysLeft = null,
  navs,
  actions,
  icons,
  lockedHrefs = [],
  badges: serverBadges = [],
  counts,
  usage = [],
  canUpgrade = false,
  vitrinHref = null,
  storageScope,
  role = null,
  scopeCookie = null,
}: {
  officeName: string;
  /** Sunucuda çizilen ofis kartı (logo/şehir kendi sınırında akar). */
  officeCard?: ReactNode;
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
  /** Gerçek veriden uyarı rozetleri (geciken görev, bekleyen onay). */
  badges?: NavBadge[];
  /** Nötr sayı rozetleri + durum noktaları (söz: kabuğu bekletmez; `loadNavCounts`). */
  counts?: Promise<NavCounts>;
  /** Paket limitine karşı gerçek kullanım; limitsiz kalemler gelmez. */
  usage?: PlanUsageRow[];
  canUpgrade?: boolean;
  vitrinHref?: string | null;
  /** `${tenantId}:${userId}` — menü durum tercihlerinin yerel anahtarı. */
  storageScope?: string;
  /** Etkin rol: merkez yapısını ve mobil alt çubuğu belirler (yetkiyi değiştirmez). */
  role?: string | null;
  /** Kapsam çerezi (es_scope): yönetim rolü "Benim işlerim" seçtiyse menü kişisel düzene geçer (yalnız görünüm). */
  scopeCookie?: string | null;
}) {
  const pathname = usePathname();
  const { nav, extra, navRole, personal } = useShellNav(navs, role, scopeCookie);
  // Gelen kutusu "Yanıt bekliyor" rozeti (COM-01): menüde gelen kutusu varsa boşta sorulur; kabuk akışını bekletmez.
  const inboxBadge = useInboxBadge(nav.hubs.some((h) => h.pages.some((p) => p.href === INBOX_ITEM_HREF)));
  const badges = useMemo(() => (inboxBadge ? [...serverBadges, inboxBadge] : serverBadges), [serverBadges, inboxBadge]);
  const VitrinIcon = glyph(icons.portal);
  const ToolsIcon = glyph(icons.tools);
  const ModulesIcon = glyph(icons.modules);
  // Çekmece durumu üst çubuktaki/alt çubuktaki "Menü" ile ortak bağlamda.
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
  const closeDrawer = () => setOpen(false);
  // Bağlantı gezinmeyi kendisi yapar; tıklamada kapsam çerezi yazılır ve kabuk anında ofis düzenine döner.
  const backToOffice = () => {
    document.cookie = `${SCOPE_COOKIE}=ofis; path=/app; max-age=${SCOPE_COOKIE_MAX_AGE}; samesite=lax`;
    announceScope("ofis");
    closeDrawer();
  };

  // Ofisin kapattığı modüller menüden çıkar (veri silinmez): süzgeç sunucuda (`navs`) uygulanmıştır.
  const active = resolveActiveHubIn(pathname, nav, extra);
  const activeHubId = active.hub?.id ?? null;

  const closedStore = getHrefStore("closed", storageScope);
  // "closed" deposu menü DURUM kimliklerini tutar: araclar-degisti (Araçlar grubunun varsayılandan ters durumu),
  // ac-<merkez> (kullanıcının açtığı alt liste) ve kp-<merkez> (etkin merkezde kullanıcının kapattığı alt liste).
  const stateIds = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggleState = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const toolsOpen = active.inTools || stateIds.includes("araclar-degisti");
  const subOpen = (hub: NavHub) => {
    const isActive = hub.id === activeHubId && !active.inDock;
    return isActive ? !stateIds.includes(`kp-${hub.id}`) : stateIds.includes(`ac-${hub.id}`);
  };
  const toggleSub = (hub: NavHub) => toggleState(hub.id === activeHubId && !active.inDock ? `kp-${hub.id}` : `ac-${hub.id}`);

  // Boşta ısıtılan hedefler: rolün menü merkezleri ve alt sabit satırlar (menü sırası; etkin sayfa ve kilitliler atlanır).
  const idleTargets = [...nav.hubs, ...nav.dock].map((h) => h.href).filter((h) => h !== active.pageHref && !isLocked(h, lockedHrefs));
  // Kademe `hubs`: ilk 3 merkez TAM, kalanı yalnız ucuz rota ağacı (hedefin kendi iskeleti anında gelir); kardeş sekmelerden SONRA.
  useIdlePrefetch(idleTargets, 14, { tier: "hubs" });

  // "Son açılanlar" (yalnız çekmece): sayfa yolları, yerel ve kullanıcıya özel (localStorage, try/catch).
  const recentStore = getHrefStore("recent", storageScope);
  const recents = useSyncExternalStore(recentStore.subscribe, recentStore.read, recentStore.getServerSnapshot);
  const pageIndex = useMemo(() => {
    const m = new Map<string, HubPage>();
    for (const p of [...nav.hubs, ...nav.dock].flatMap((h) => h.pages).concat(nav.tools)) if (!m.has(p.href)) m.set(p.href, p);
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

  const billingHub = nav.dock.find((h) => h.id === "abonelik") ?? nav.hubs.find((h) => h.id === "abonelik") ?? null;
  const dockRows = nav.dock.filter((h) => h.id !== "abonelik");
  const mainHubs = nav.hubs.filter((h) => h.id !== "abonelik");

  const rowClass = (isActive: boolean) =>
    `nav-row focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] pl-3 pr-2 text-sm transition-colors lg:min-h-9 touch:min-h-11 ${
      isActive ? "nav-pill font-semibold" : "text-white/80 hover:bg-white/6 hover:text-white"
    }`;

  /** Ana satır: bağlantı (ikon + ad) + sağda rozet/sayı/nokta + (alt listeli merkezde) ok düğmesi; açıkken alt sayfalar. */
  const renderHub = (hub: NavHub, opts: { dock?: boolean } = {}) => {
    const isActive = hub.id === activeHubId && active.inDock === Boolean(opts.dock);
    const badge = hubBadge(hub, badges);
    const locked = isLocked(hub.href, lockedHrefs);
    const expandable = Boolean(hub.sub) && !opts.dock;
    const expanded = expandable && subOpen(hub);
    const subId = `sb-sub-${hub.id}`;
    const tip = hub.pages.length > 1 ? `${hub.label}: ${hub.pages.slice(0, 5).map((p) => p.label).join(", ")}` : (hub.pages[0]?.description ?? hub.label);
    return (
      <div key={`${opts.dock ? "dock" : "hub"}-${hub.id}`} className="nav-item">
        <div className={`group relative flex items-center gap-1 rounded-[var(--radius-control)] ${isActive ? "is-active" : ""}`}>
          <Link
            href={hub.href}
            data-nav-link
            data-nav-active={isActive ? "true" : undefined}
            aria-current={isActive ? "page" : undefined}
            title={tip}
            onClick={closeDrawer}
            className={rowClass(isActive)}
          >
            <hub.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{hub.label}</span>
            {locked ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
            {/* Sağ uç yer tutucu: rozet/sayı mutlak konumla bu alana oturur (satır yüksekliği ve metin kesimi sabit). */}
            {badge || counts ? <span className="sb-end-pad" aria-hidden /> : null}
          </Link>
          <span className={`sb-end ${expandable ? "has-chevron" : ""}`}>
            {badge ? (
              <Link
                href={badge.href}
                onClick={closeDrawer}
                aria-label={badge.label}
                title={badge.label}
                className={`nav-badge focus-ring ${badge.tone === "danger" ? "is-danger" : "is-warn"}`}
              >
                {badge.count > 99 ? "99+" : badge.count}
              </Link>
            ) : counts ? (
              <Suspense fallback={null}>
                <RowCount hub={hub} counts={counts} onNavigate={closeDrawer} />
              </Suspense>
            ) : null}
          </span>
          {expandable ? (
            <button
              type="button"
              onClick={() => toggleSub(hub)}
              aria-expanded={expanded}
              aria-controls={subId}
              aria-label={`${hub.label} alt menüsü`}
              className="sb-chev focus-ring grid h-9 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-white/60 transition hover:bg-white/8 hover:text-white touch:h-11 touch:w-11"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden />
            </button>
          ) : null}
        </div>
        {expanded ? (
          <ul id={subId} className="sb-sub" aria-label={`${hub.label} sayfaları`}>
            {hub.pages.slice(0, 8).map((pg) => {
              const on = isActive && active.pageHref === pg.href;
              return (
                <li key={pg.href}>
                  <Link
                    href={pg.href}
                    data-nav-link
                    aria-current={on ? "page" : undefined}
                    onClick={closeDrawer}
                    className={`focus-ring flex min-h-9 items-center rounded-[var(--radius-control)] px-3 text-sm transition-colors touch:min-h-11 ${on ? "sb-sub-on font-semibold text-white" : "text-white/70 hover:bg-white/6 hover:text-white"}`}
                  >
                    <span className="min-w-0 truncate">{pg.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
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
        onClick={closeDrawer}
        className={rowClass(isActive)}
      >
        <page.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
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
          className="nav-row focus-ring flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-sm text-white/75 transition-colors hover:bg-white/6 hover:text-white lg:min-h-9 touch:min-h-11"
        >
          <ToolsIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
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
      onClick={closeDrawer}
      title="Kullanmadığınız modülleri tek tıkla gizleyin veya açın"
      className="nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/65 transition-colors hover:bg-white/8 hover:text-white lg:min-h-9"
    >
      <ModulesIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span>Menüyü düzenle</span>
    </Link>
  );

  const renderContent = (variant: "desktop" | "drawer") => (
    <>
      <div className="sb-head flex min-h-14 shrink-0 items-center gap-3 px-4">
        <Brand variant="mark" tone="dark" height={34} alt="" className="rounded-[var(--radius-control)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-lg font-extrabold leading-5 tracking-tight text-white">EmlakSoft</p>
          <p className="truncate text-xs font-medium text-white/60">Profesyonel Emlak Yazılımı</p>
        </div>
        {variant === "desktop" ? <SidebarCollapseButton /> : null}
      </div>
      {officeCard}
      {personal ? (
        <Link
          href="/app?kapsam=ofis"
          onClick={backToOffice}
          className="focus-ring sb-label mx-3 mb-2 flex min-h-11 items-center rounded-[var(--radius-control)] border border-white/15 px-3 text-xs font-semibold text-white/80 transition hover:bg-white/10"
        >
          Ofis görünümüne dön
        </Link>
      ) : null}

      <NavScroller label="Uygulama ana menüsü" className={`sb-pad flex-1 overscroll-contain px-3${variant === "drawer" ? " nav-scroll-drawer" : ""}`} innerClassName="pb-3">
        <div className="sb-expanded">
          {variant === "drawer" && recentRows.length > 0 ? (
            <div className="pt-1">
              <p className="sb-heading">Son açılanlar</p>
              <div className="space-y-0.5">
                {recentRows.map((r) => (
                  <Link
                    key={r.href}
                    href={r.href}
                    data-nav-link
                    onClick={closeDrawer}
                    className="nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white"
                  >
                    <r.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  </Link>
                ))}
              </div>
              <p className="sb-heading">Menü</p>
            </div>
          ) : null}
          <div className="space-y-0.5 pt-1">
            {mainHubs.map((hub) => (
              <Fragment key={hub.id}>
                {hub.heading ? <p className="sb-heading">{hub.heading}</p> : null}
                {renderHub(hub)}
              </Fragment>
            ))}
          </div>

          {/* Alt bölüm: Yardım (alt sabit), vitrin kısayolu, Araçlar (kapalı grup) ve Menüyü düzenle. */}
          <div className="mt-3 space-y-0.5 border-t border-white/10 pt-3">
            {dockRows.map((hub) => renderHub(hub, { dock: true }))}
            {vitrinHref ? (
              <a
                href={vitrinHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Ofis vitrinini yeni sekmede aç"
                className="nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/75 transition-colors hover:bg-white/6 hover:text-white lg:min-h-9 touch:min-h-11"
              >
                <VitrinIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">Vitrini görüntüle</span>
                <span className="sr-only">(yeni sekme)</span>
              </a>
            ) : null}
            {renderTools()}
            {renderEditMenu()}
          </div>
        </div>

        {/* İkon modu (64px): merkez başına tek ikon; hover/odakta sağda sayfa listesi + hızlı eylemler. */}
        {variant === "desktop" ? (
          <div className="sb-rail space-y-1 pt-3">
            {[...mainHubs, ...dockRows].map((hub) => {
              const inDock = dockRows.includes(hub);
              const isActive = hub.id === activeHubId && active.inDock === inDock;
              const badge = hubBadge(hub, badges);
              return (
                <NavFlyout
                  key={hub.id}
                  enabled
                  title={hub.label}
                  href={hub.href}
                  items={hub.pages.length > 1 ? hubFlyoutItems(hub) : []}
                  actions={inDock ? [] : actionsFor(hub)}
                >
                  <Link
                    href={hub.href}
                    data-nav-link
                    data-nav-active={isActive ? "true" : undefined}
                    aria-current={isActive ? "true" : undefined}
                    aria-label={badge ? `${hub.label}, ${badge.label}` : hub.label}
                    className={`nav-row focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                      isActive ? "nav-pill" : "text-white/70 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <hub.icon className="h-[18px] w-[18px]" aria-hidden />
                    {badge ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-400" aria-hidden /> : null}
                  </Link>
                </NavFlyout>
              );
            })}
            {nav.tools.length > 0 ? (
              <NavFlyout
                enabled
                title="Araçlar"
                items={nav.tools.map((t) => ({ href: t.href, label: t.label, icon: t.icon, active: active.inTools && active.pageHref === t.href }))}
              >
                <Link
                  href={nav.tools[0]!.href}
                  data-nav-link
                  data-nav-active={active.inTools ? "true" : undefined}
                  aria-current={active.inTools ? "true" : undefined}
                  aria-label="Araçlar"
                  className={`nav-row focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    active.inTools ? "nav-pill" : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <ToolsIcon className="h-[18px] w-[18px]" aria-hidden />
                </Link>
              </NavFlyout>
            ) : null}
          </div>
        ) : null}
      </NavScroller>

      {/* Paketim kartı (kurumsal referans): paket adı, kullanıcı n/m, kalan deneme günü, doluluk, "Paketini Yükselt". */}
      <div className="sb-foot shrink-0 px-3 pb-3 pt-2">
        <PackageCard
          plan={plan}
          trialDaysLeft={trial ? trialDaysLeft : null}
          usage={usage}
          canUpgrade={canUpgrade && (role === "owner" || role === "gm")}
          billingHref={billingHub?.href ?? null}
          onNavigate={closeDrawer}
        />
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
      {/* Ray (shell-track) sayfa boyunca uzanır ve lacivert zemini taşır; menü onun içinde ekran boyu yapışkandır
          (uzun sayfada menünün altı beyaz kalmaz). */}
      <div className="shell-aside shell-track app-sb-track hidden shrink-0 lg:block">
        <aside className="shell-aside sb-surface sticky top-[env(safe-area-inset-top)] flex h-[calc(100dvh-env(safe-area-inset-top))] flex-col overflow-hidden app-sb">
          {renderContent("desktop")}
        </aside>
      </div>
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
        <div className="sb-surface app-sb fixed inset-y-0 left-0 z-50 h-dvh w-[min(88vw,300px)] overflow-hidden pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-[var(--shadow-lg)]">
          <div className="flex min-h-11 items-center gap-3 border-b border-white/8 px-4">
            <span className="h-8 w-8 rounded-[var(--radius-card)] bg-white/10" />
            <span className="min-w-0">
              <span className="block font-display text-base font-extrabold text-white">EmlakSoft</span>
              <span className="block truncate text-xs text-white/60">{officeName}</span>
            </span>
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
              {splitNewActions(newActions, true).primary.map((a) => (
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
        className="mbar fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
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
