"use client";

import Link from "@/components/ui/smart-link";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { Brand } from "@/components/brand/brand";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, Crown, Lock, Menu, Plus, type LucideIcon } from "lucide-react";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import { getHrefStore, pushRecent } from "@/lib/nav-memory";
import { activeTabHref, resolveActiveHubIn, type ShellAction, type ShellHub, type ShellIcon, type ShellNavSet, type ShellPage } from "@/lib/nav-shell";
import { glyph, useShellNav } from "@/components/app/nav-glyph";
import { useMobileMenu } from "@/components/app/mobile-menu-trigger";
import { mobileNewActions, SHEET_ROW_CLASS, splitNewActions } from "@/components/app/mobile-new-sheet";
import { clearTapVeilAttr, pressOpenHandlers, TAP_VEIL_CLASS, useTapVeil } from "@/components/app/tap-veil";
import { NAV_COUNT_META, type NavCounts } from "@/lib/app-shell/nav-count-meta";
import { SidebarCollapseButton, SidebarCollapseRow } from "@/components/ui/console/sidebar-collapse";
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

/** Grup başlığı (GÜNLÜK İŞ…): 32 px yükseklik (12 + 16 + 4; v5 nefesli bölüm aralığı), büyük harf (html lang="tr": "iş" → "İŞ"), satır ritmini bozmaz. */
const GROUP_CLASS = "sb-group px-3 pb-1 pt-3 text-xs font-bold uppercase leading-4 tracking-[0.13em] text-white/50";
type HubPage = ShellPage<LucideIcon>;
/** Grup durum anahtarı (yerel depo + DOM kimliği): başlıktan türetilir ("Müşteri ve portföy" → "musteri-ve-portfoy"). */
const groupSlug = (title: string) =>
  title
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Yan menünün sabit ikonları (ikon sözlüğü `src/lib/icons.ts`; sunucuda çözülür, bkz. nav-shell-server). */
export type SidebarIcons = { portal: ShellIcon; tools: ShellIcon; modules: ShellIcon };

function isLocked(href: string, lockedHrefs: readonly string[]) {
  return isHrefLocked(href, lockedHrefs);
}

/** Sayaç tonu (sayaç kuralı): kırmızı = gecikmiş, turuncu = karar bekliyor, gri = bilgi. */
type Tone = "danger" | "warn" | "info";
type RowSignal = { count: number; href: string; label: string; tone: Tone };

/** Rozet tonu kaynağında belirlenir (gelen kutusu "yanıt bekliyor" = info, `@/lib/inbox-badge`). */
const badgeTone = (b: NavBadge): Tone => b.tone;

/**
 * Rozetin satırı: rozetin sayfası satırın TEMEL (şeritte önde) sayfasıysa o satırda görünür. Böylece bir satırın sayacı
 * yalnız adının söylediği işi sayar ("Anlaşmalarım" Tümü altındaki Onaylar'ı saymaz; Ajanda geciken görevi sayar).
 */
function ownsBadge(hub: NavHub, b: NavBadge): boolean {
  const pages = hub.pages.length === 1 ? hub.pages : hub.pages.filter((p) => p.core);
  return pages.some((p) => p.href === b.itemHref || p.itemHref === b.itemHref);
}

/** Satırın sunucu rozeti (geciken görev, bekleyen onay, gelen kutusu); birden çoksa en acil ton ve toplam. */
function hubBadge(hub: NavHub, badges: readonly NavBadge[]): RowSignal | null {
  const own = badges.filter((b) => ownsBadge(hub, b));
  const first = own[0];
  if (!first) return null;
  const tones = own.map(badgeTone);
  return {
    count: own.reduce((n, b) => n + b.count, 0),
    // Tek rozet kendi süzgeçli hedefine (ör. geciken görevler), birden çoksa merkezin girişine gider.
    href: own.length === 1 ? first.href : hub.href,
    label: own.map((b) => `${b.count} ${b.label}`).join(", "),
    tone: tones.includes("danger") ? "danger" : tones.includes("warn") ? "warn" : "info",
  };
}

/** Akışlı sayaçlardan satırın sinyali: önce gecikmiş (kırmızı), yoksa bilgi (gri). */
function streamSignal(hub: NavHub, data: NavCounts): RowSignal | null {
  for (const [bucket, tone] of [[data.alerts, "danger"], [data.counts, "info"]] as const) {
    for (const p of hub.pages) {
      const n = bucket[p.href];
      if (!n) continue;
      const meta = NAV_COUNT_META[p.href];
      return { count: n, href: meta?.href ?? p.href, label: `${n} ${meta?.label ?? p.label}`, tone };
    }
  }
  return null;
}

/** Ana Sayfa acil sayacı: tüm gecikmiş işlerin toplamı (geciken görev + geciken kira); ana ekranın "Dikkat" listesiyle aynı küme. */
function urgentSignal(badges: readonly NavBadge[], data: NavCounts | null): RowSignal | null {
  const parts = badges.filter((b) => badgeTone(b) === "danger").map((b) => ({ n: b.count, label: b.label }));
  if (data) for (const [href, n] of Object.entries(data.alerts)) parts.push({ n, label: NAV_COUNT_META[href]?.label ?? href });
  const count = parts.reduce((t, x) => t + x.n, 0);
  if (count === 0) return null;
  // Hedef: ana sayfadaki "Dikkat gerektirenler" listesi (aynı "Acil" kalemler: geciken kira + geciken görev).
  return { count, href: "/app#dikkat", label: `${count} acil iş: ${parts.map((x) => `${x.n} ${x.label}`).join(", ")}`, tone: "danger" };
}

function SignalPill({ signal, onNavigate, max = 99, className = "" }: { signal: RowSignal; onNavigate: () => void; max?: number; className?: string }) {
  const text = signal.count > max ? `${max}+` : signal.count;
  if (signal.tone === "info") {
    return (
      <Link href={signal.href} onClick={onNavigate} className={`sb-count focus-ring ${className}`} aria-label={signal.label} title={signal.label}>
        {text}
      </Link>
    );
  }
  return (
    <Link href={signal.href} onClick={onNavigate} aria-label={signal.label} title={signal.label} className={`nav-badge focus-ring ${signal.tone === "danger" ? "is-danger" : "is-warn"} ${className}`}>
      {text}
    </Link>
  );
}

/** Satır sağ ucu (akışlı): Ana Sayfa acil toplamı; diğerlerinde gecikmiş/bilgi sayısı ya da durum noktası. */
function RowCount({ hub, badges, counts, onNavigate }: { hub: NavHub; badges: readonly NavBadge[]; counts: Promise<NavCounts>; onNavigate: () => void }) {
  const data = use(counts);
  if (hub.id === "bugun") {
    const urgent = urgentSignal(badges, data);
    return urgent ? <SignalPill signal={urgent} onNavigate={onNavigate} /> : null;
  }
  const signal = streamSignal(hub, data);
  if (signal) return <SignalPill signal={signal} onNavigate={onNavigate} max={999} />;
  const dot = hub.pages.map((p) => data.dots[p.href]).find(Boolean);
  if (!dot) return null;
  return (
    <span
      className={`sb-dot ${dot === "ok" ? "is-ok" : "is-warn"}`}
      role="img"
      aria-label={dot === "ok" ? "Sahibinden eşitlemesi güncel" : "Sahibinden eşitlemesi 3 günden eski"}
      title={dot === "ok" ? "Sahibinden eşitlemesi güncel" : "Son yeni sahibinden ilanı 3 günden eski"}
    />
  );
}

/** Mobil alt çubuk yuvası sayacı (akışlı): masaüstü satırıyla aynı kural, küçük rozet. */
function SlotCount({ hub, badges, counts }: { hub: NavHub; badges: readonly NavBadge[]; counts: Promise<NavCounts> }) {
  const data = use(counts);
  const signal = hub.id === "bugun" ? urgentSignal(badges, data) : streamSignal(hub, data);
  return signal ? <SlotBadge signal={signal} /> : null;
}

function SlotBadge({ signal }: { signal: RowSignal }) {
  const tone = signal.tone === "danger" ? "is-danger" : signal.tone === "warn" ? "is-warn" : "bg-text-muted";
  return (
    <span className={`nav-badge absolute -right-1 -top-1 ${tone}`} aria-hidden>
      {signal.count > 99 ? "99+" : signal.count}
    </span>
  );
}

/**
 * Paketim SATIRI (sahip kararı 2026-10-17: sabit kart değil, menü sonundaki normal satır): taç ikonu + "Profesyonel ·
 * 8/15 kullanıcı · 247 gün kaldı" (tek satır, sığmazsa "…" + title); koltuk %80 dolunca meta turuncu, doluysa kırmızı.
 * "Paketini yükselt" yalnız ofis sahibi/genel müdürde küçük altın ikon düğmesi.
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
  const metaParts = [seats ? `${seats.used}/${seats.limit} kullanıcı` : null, trialDaysLeft != null ? `${trialDaysLeft} gün kaldı` : null].filter((x): x is string => Boolean(x));
  const meta = metaParts.join(" · ");
  const tip = `Paketim: ${plan}${meta ? ` · ${meta}` : ""}`;
  const body = (
    <>
      <span className="sb-pkg-ico" aria-hidden>
        <Crown className="h-3.5 w-3.5" />
      </span>
      <span className="sb-label min-w-0 flex-1 truncate">
        <span className="font-semibold text-white">{plan}</span>
        {meta ? <span className={`sb-pkg-meta num is-${tone}`}> · {meta}</span> : null}
      </span>
    </>
  );
  return (
    <div className="sb-pkg nav-item">
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
 * Yan menü (masaüstü kenar çubuğu + mobil çekmece) ve mobil alt çubuk (sahip kararı 2026-10-17, referans konsol düzeni):
 * logo bloğu → ofis kartı (logo, ad, şehir, paket, ofis skoru) → başlıksız ilk satırlar (Ana Sayfa) → başlıklı, varsayılan
 * AÇIK gruplar (GÜNLÜK İŞLER, MÜŞTERİ VE PORTFÖY, SATIŞ, FİNANS, YÖNETİM, AYARLAR VE YARDIM; başlıktan kapatılır, kullanıcıya
 * özel hatırlanır; satır ikon + ad + sayaç, üçüncü düzey yok) → menü sonu satırları (Araçlar, Menüyü daralt). SABİT ALT
 * BÖLÜM YOK: Ayarlar, Yardım ve Paketim satırı listeyle kayar. Sayaç kuralı: kırmızı = gecikmiş, turuncu = karar
 * bekliyor, gri = bilgi; satırın sayacı yalnız adının söylediğini sayar. Etkin satır yumuşak altın hap.
 * Merkezin kardeş sayfaları sayfanın üstündeki TEK sekme şeridindedir (SectionTabs); yan menü aynı listeyi kendiliğinden
 * açmaz. Mobil alt çubuk rol bazlıdır (en çok 5 yuva, "+ Yeni", "Menü" çekmecesi; yuvalarda aynı sayaçlar); çekmece
 * masaüstüyle AYNI içeriktir.
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
  // Ana Sayfa acil sayacının anında bilinen kısmı (sunucu rozetleri); akışlı gecikmiş işler gelince RowCount tamamlar.
  const urgentNow = urgentSignal(badges, null);
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
  const sekme = useSearchParams().get("sekme");
  const pathActive = resolveActiveHubIn(pathname, nav, extra);
  // `?sekme=` görünümü merkezde kendi sekmesiyse (Eşleşme, Rapor merkezi) alt listede o satır etkin (şeritle aynı kural).
  const active = pathActive.hub
    ? { ...pathActive, pageHref: activeTabHref(pathActive.pageHref, sekme, pathActive.hub.pages.map((p) => p.href)) }
    : pathActive;
  const activeHubId = active.hub?.id ?? null;

  const closedStore = getHrefStore("closed", storageScope);
  // "closed" deposu menü DURUM kimliklerini tutar: araclar-degisti (Araçlar grubunun varsayılandan ters durumu) ve
  // g-<grup> (kullanıcının kapattığı grup başlığı; varsayılan açık).
  const stateIds = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggleState = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const toolsOpen = active.inTools || stateIds.includes("araclar-degisti");

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

  // Satır yüksekliği masaüstünde ~40 px (console-shell.css --sb-row-h: 2.625rem, 15 px etiket). Sabit alt bölüm YOK:
  // Ayarlar · Yardım · Paketim satırı · Araçlar · Menüyü daralt listenin sonunda, menüyle birlikte kayar.
  const rowClass = (isActive: boolean) =>
    `nav-row focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] pl-3 pr-2 text-sm transition-colors lg:min-h-8 touch:min-h-11 ${
      isActive ? "nav-pill font-semibold" : "text-white/80 hover:bg-white/6 hover:text-white"
    }`;

  /**
   * Satır (sahip kararı 2026-10-17, referans konsol düzeni): ikon + ad + sağda rozet/sayı/nokta. Merkezin kardeş sayfaları
   * sayfanın üstündeki TEK sekme şeridindedir; yan menüde üçüncü düzey (alt liste) yoktur.
   */
  const renderHub = (hub: NavHub, opts: { dock?: boolean } = {}) => {
    const isActive = hub.id === activeHubId && active.inDock === Boolean(opts.dock);
    const badge = hubBadge(hub, badges);
    const locked = isLocked(hub.href, lockedHrefs);
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
            <hub.icon className="h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{hub.label}</span>
            {locked ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
            {/* Sağ uç yer tutucu: rozet/sayı mutlak konumla bu alana oturur (satır yüksekliği ve metin kesimi sabit). */}
            {(badge || counts || (hub.id === "bugun" && urgentNow)) && !(hub.id === "bugun" && isActive) ? <span className="sb-end-pad" aria-hidden /> : null}
          </Link>
          <span className="sb-end">
            {hub.id === "bugun" ? (
              // Acil toplam: sunucu rozetleri anında, akışlı gecikmiş işler (geciken kira) gelince eklenir. Ana sayfa
              // açıkken sayaç gizlenir (etkin hapta kalabalık yok; aynı işler sayfadaki "Dikkat gerektirenler"de).
              isActive ? null : counts ? (
                <Suspense fallback={urgentNow ? <SignalPill signal={urgentNow} onNavigate={closeDrawer} /> : null}>
                  <RowCount hub={hub} badges={badges} counts={counts} onNavigate={closeDrawer} />
                </Suspense>
              ) : urgentNow ? (
                <SignalPill signal={urgentNow} onNavigate={closeDrawer} />
              ) : null
            ) : badge ? (
              <SignalPill signal={badge} onNavigate={closeDrawer} />
            ) : counts ? (
              <Suspense fallback={null}>
                <RowCount hub={hub} badges={badges} counts={counts} onNavigate={closeDrawer} />
              </Suspense>
            ) : null}
          </span>
        </div>
      </div>
    );
  };

  /**
   * Grup (GÜNLÜK İŞLER…): başlık düğmesi grubu satır içinde kapatır/açar. Varsayılan AÇIK; kullanıcının kapattığı grup
   * ("g-<grup>", kullanıcıya özel yerel durum) kapalı kalır; etkin merkezin grubu her zaman açıktır.
   */
  const renderGroup = (g: { id: string; title: string | null; hubs: NavHub[]; dock?: boolean; extra?: ReactNode }) => {
    const hasActive = g.hubs.some((h) => h.id === activeHubId && active.inDock === Boolean(g.dock));
    const rows = (
      <div id={`sb-g-${g.id}`} className="sb-group-rows space-y-px">
        {g.hubs.map((h) => renderHub(h, { dock: g.dock }))}
        {g.extra}
      </div>
    );
    if (!g.title) return <div key={g.id} className="space-y-px pt-1">{rows}</div>;
    const expanded = hasActive || !stateIds.includes(`g-${g.id}`);
    return (
      <div key={g.id}>
        <button
          type="button"
          onClick={() => toggleState(`g-${g.id}`)}
          disabled={hasActive}
          aria-expanded={expanded}
          aria-controls={`sb-g-${g.id}`}
          title={g.title}
          className={`${GROUP_CLASS} sb-group-btn focus-ring flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] text-left transition-colors hover:text-white disabled:cursor-default touch:min-h-11`}
        >
          <span className="min-w-0 flex-1 truncate">{g.title}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
          <span className="sr-only">{expanded ? "grubu kapat" : "grubu aç"}</span>
        </button>
        {expanded ? rows : null}
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
        <page.icon className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{page.label}</span>
        {isLocked(page.href, lockedHrefs) ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
      </Link>
    );
  };

  const hubFlyoutItems = (hub: NavHub) =>
    hub.pages.map((p) => ({ href: p.href, label: p.label, icon: p.icon, active: p.href === active.pageHref && hub.id === activeHubId }));

  // Araçlar bölümü (menü merkezi değil): değerleme, hesaplayıcı… + vitrin kısayolu + Menüyü düzenle. Menü sonundaki
  // "Araçlar" satırı açar/kapatır; açıkken hemen altında satır içi görünür.
  const renderTools = () =>
    toolsOpen ? (
      <div id="sb-araclar" className="space-y-px">
        {nav.tools.map(renderTool)}
        {vitrinHref ? (
          <a
            href={vitrinHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Ofis vitrinini yeni sekmede aç"
            className="nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/75 transition-colors hover:bg-white/6 hover:text-white lg:min-h-8 touch:min-h-11"
          >
            <VitrinIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Vitrini görüntüle</span>
            <span className="sr-only">(yeni sekme)</span>
          </a>
        ) : null}
        {renderEditMenu()}
      </div>
    ) : null;
  // Menüyü düzenle: kullanılmayan modülleri tek tıkla aç/kapat. Ofis sahibi/genel müdür ofis genelini, diğerleri
  // yalnız kendi menüsünü düzenler (yeni sayfa yok; mevcut ayar ekranlarına gider).
  const renderEditMenu = () => (
    <Link
      href={role === "owner" || role === "gm" ? "/app/ayarlar/moduller" : "/app/hesabim?sekme=gorunum"}
      onClick={closeDrawer}
      title="Kullanmadığınız modülleri tek tıkla gizleyin veya açın"
      className="nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/65 transition-colors hover:bg-white/8 hover:text-white lg:min-h-8"
    >
      <ModulesIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span>Menüyü düzenle</span>
    </Link>
  );

  // Mobil alt çubuk: rol bazlı en çok 5 yuva (nav-roles `mobile`): merkez bağlantıları, "+ Yeni" eylem sayfası, "Menü"
  // çekmecesi. Çekmece masaüstüyle AYNI yapıdır (grup başlıklı merkez listesi). Yetkisiz/kapalı merkez yuvası çıkmaz.
  const newActions = useMemo(() => mobileNewActions(navRole, allActions), [navRole, allActions]);
  type Slot = { kind: "hub"; hub: NavHub } | { kind: "new" } | { kind: "menu" };
  const slots = nav.mobile.flatMap<Slot>((slot) => {
    if (slot === "menu") return [{ kind: "menu" }];
    if (slot === "new") return newActions.length > 0 ? [{ kind: "new" }] : [];
    const hub = nav.hubs.find((h) => h.id === slot);
    return hub ? [{ kind: "hub", hub }] : [];
  });
  // Alt çubukta kendi yuvası olan merkezin rozeti yuvada görünür. "Bugün" yuvası acil toplamı (gecikmişler) taşır;
  // "Menü" yalnız çekmecedeki (yuvası olmayan) satırlarda KARAR bekleyen işleri sayar (onay; gecikmişler Bugün'dedir).
  const slotHubs = slots.flatMap((s) => (s.kind === "hub" ? [s.hub] : []));
  const hasTodaySlot = slotHubs.some((h) => h.id === "bugun");
  const drawerBadges = badges.filter(
    (b) => badgeTone(b) !== "info" && !(hasTodaySlot && badgeTone(b) === "danger") && !slotHubs.some((h) => ownsBadge(h, b)) && mainHubs.some((h) => ownsBadge(h, b)),
  );
  const totalBadges = drawerBadges.reduce((n, b) => n + b.count, 0);
  const menuTone = drawerBadges.some((b) => badgeTone(b) === "danger") ? "is-danger" : "is-warn";
  const menuLabel = totalBadges > 0 ? `Menü: tüm sayfalar, ${drawerBadges.map((b) => `${b.count} ${b.label}`).join(", ")}` : "Menü: tüm sayfalar";

  // Grup kovaları: görünen satırın grubu bir öncekinden farklıysa yeni başlık (yetkiyle gizlenen ilk satır başlığı götürmez).
  const hubGroups: { id: string; title: string | null; hubs: NavHub[]; dock?: boolean; extra?: ReactNode }[] = [];
  mainHubs.forEach((hub, i) => {
    const title = hub.group ?? null;
    if (i === 0 || hub.group !== mainHubs[i - 1]?.group) hubGroups.push({ id: title ? groupSlug(title) : `ust-${i}`, title, hubs: [hub] });
    else hubGroups[hubGroups.length - 1]!.hubs.push(hub);
  });
  if (dockRows.length > 0 || billingHub) {
    hubGroups.push({
      id: "ayarlar",
      title: "Ayarlar ve yardım",
      hubs: dockRows,
      dock: true,
      // Paketim: kart değil, normal satır ("Profesyonel · 8/15 kullanıcı"); yalnız aboneliği açabilen rolde bağlantılı.
      extra: billingHub ? (
        <PackageCard
          plan={plan}
          trialDaysLeft={trial ? trialDaysLeft : null}
          usage={usage}
          canUpgrade={canUpgrade && (role === "owner" || role === "gm")}
          billingHref={billingHub.href}
          onNavigate={closeDrawer}
        />
      ) : null,
    });
  }

  /** Menü sonu satırları (sabit DEĞİL, listeyle kayar): Araçlar (aç/kapat) + açık liste + Menüyü daralt (masaüstü). */
  const tailRow = "sb-util focus-ring flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-sm text-white/75 transition-colors hover:bg-white/8 hover:text-white lg:min-h-9 touch:min-h-11";
  const renderTail = (variant: "desktop" | "drawer") => (
    <div className="sb-tail mt-3 space-y-px border-t border-white/8 pt-2">
      {nav.tools.length > 0 || vitrinHref ? (
        <button
          type="button"
          onClick={() => toggleState("araclar-degisti")}
          aria-expanded={toolsOpen}
          aria-controls="sb-araclar"
          title="Araçlar: değerleme, hesaplayıcı, yardımcı, vitrin ve menü düzeni"
          className={`${tailRow} ${active.inTools ? "text-white" : ""}`}
        >
          <ToolsIcon className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Araçlar</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-white/55 transition-transform ${toolsOpen ? "" : "-rotate-90"}`} aria-hidden />
        </button>
      ) : null}
      {renderTools()}
      {variant === "desktop" ? <SidebarCollapseRow className={tailRow} /> : null}
    </div>
  );

  const renderContent = (variant: "desktop" | "drawer", drawerTools?: ReactNode) => (
    <>
      <div className="sb-head flex min-h-14 shrink-0 items-center gap-3 px-4 lg:min-h-12 lg:py-2!">
        <Brand variant="mark" tone="light" height={38} alt="" className="sb-mark rounded-[var(--radius-control)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-lg font-extrabold leading-5 tracking-tight text-white">EmlakSoft</p>
          {/* Alt başlık kesilmez: dar başlık satırında (daraltma düğmesi yanında) iki satıra iner. */}
          <p className="text-xs font-medium leading-4 text-white/60">Profesyonel Emlak Yazılımı</p>
        </div>
        {variant === "desktop" ? <SidebarCollapseButton /> : null}
      </div>
      {officeCard}
      {personal ? (
        <Link
          href="/app?kapsam=ofis"
          onClick={backToOffice}
          className="focus-ring sb-label mx-3 mb-2 flex min-h-11 items-center rounded-[var(--radius-control)] border border-white/15 px-3 text-xs font-semibold text-white/80 transition hover:bg-white/10 lg:min-h-8"
        >
          Ofis görünümüne dön
        </Link>
      ) : null}
      {/* Mobil çekmece üst araçları (arama + tema): çekmece parçasıyla iner (app-sidebar-drawer-tools.tsx). */}
      {variant === "drawer" ? drawerTools : null}
      {/* Tablet ikon rayı (768–1023 px, console-shell.css): alt telefon çubuğu yok; tam menü çekmecesi ve "+ Yeni" buradan. */}
      {variant === "desktop" ? (
        <div className="sb-tablet-only space-y-1 px-2 pb-1">
          <button
            type="button"
            {...pressOpenHandlers({ open: openDrawer, press: () => { warmDrawer(); showDrawerVeil(); }, cancel: hideDrawerVeil })}
            onPointerEnter={warmDrawer}
            onFocus={warmDrawer}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="app-mobile-navigation"
            aria-label={menuLabel}
            title="Menü: tüm sayfalar"
            className="nav-row focus-ring relative flex h-11 w-full items-center justify-center rounded-[var(--radius-control)] text-white/80 hover:text-white"
          >
            <Menu className="h-[18px] w-[18px]" aria-hidden />
            {totalBadges > 0 ? <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${menuTone === "is-danger" ? "bg-danger-400" : "bg-amber-400"}`} aria-hidden /> : null}
          </button>
          {newActions.length > 0 ? (
            <button
              type="button"
              {...pressOpenHandlers({ open: openNewSheet, press: () => { warmNewSheet(); showSheetVeil(); }, cancel: hideSheetVeil })}
              onPointerEnter={warmNewSheet}
              onFocus={warmNewSheet}
              aria-haspopup="dialog"
              aria-label="Hızlı ekle menüsü"
              title="Yeni kayıt ekle"
              className="sb-rail-new focus-ring press grid h-11 w-full place-items-center rounded-[var(--radius-control)]"
            >
              <Plus className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      <NavScroller label="Uygulama ana menüsü" className={`sb-pad flex-1 overscroll-contain px-3${variant === "drawer" ? " nav-scroll-drawer" : ""}`} innerClassName="pb-1">
        <div className="sb-expanded">
          {variant === "drawer" && recentRows.length > 0 ? (
            <div className="pt-1">
              <p className={GROUP_CLASS}>Son açılanlar</p>
              <div className="space-y-px">
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
              <p className={GROUP_CLASS}>Menü</p>
            </div>
          ) : null}
          {/* Gruplar (GÜNLÜK İŞLER, MÜŞTERİ VE PORTFÖY, SATIŞ, FİNANS, YÖNETİM, AYARLAR VE YARDIM): başlıksız ilk satırlar
              (Ana Sayfa) en üstte; diğerleri başlıklı, varsayılan açık. Ayarlar · Yardım · Paketim normal satırdır (sabit değil). */}
          {hubGroups.map(renderGroup)}
          {renderTail(variant)}
        </div>

        {/* İkon modu (64px): merkez başına tek ikon; hover/odakta sağda sayfa listesi + hızlı eylemler. */}
        {variant === "desktop" ? (
          <div className="sb-rail space-y-1 pt-3">
            {[...mainHubs, ...dockRows, ...(billingHub ? [billingHub] : [])].map((hub) => {
              const inDock = nav.dock.includes(hub);
              const isActive = hub.id === activeHubId && active.inDock === inDock;
              const badge = hub.id === "bugun" ? urgentNow : hubBadge(hub, badges);
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
                    {badge && badge.tone !== "info" ? (
                      <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${badge.tone === "danger" ? "bg-danger-400" : "bg-amber-400"}`} aria-hidden />
                    ) : null}
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

    </>
  );

  const slotClass = "focus-ring flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs font-semibold leading-tight transition";

  return (
    <>
      {/* Çentik (B135): iOS PWA'da kabuk durum çubuğu bandının altından başlar; kenar çubuğu da bandın altına yapışır. */}
      {/* Ray (shell-track) sayfa boyunca uzanır ve lacivert zemini taşır; menü onun içinde ekran boyu yapışkandır
          (uzun sayfada menünün altı beyaz kalmaz). */}
      <div className="shell-aside shell-track app-sb-track hidden shrink-0 lg:block">
        {/* Satır yüksekliği: console-shell.css `--sb-row-h` (42 px); orta liste kayar, alt sabit bölüm hep görünür. */}
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
            render={(tools) => renderContent("drawer", tools)}
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
                    aria-label={menuLabel}
                    className={`${slotClass} text-text-faint hover:text-ink-950`}
                  >
                    <span className="relative grid h-7 w-11 place-items-center rounded-full">
                      <Menu className="h-[18px] w-[18px]" aria-hidden />
                      {/* Menü sayacı: çekmecedeki karar bekleyen işler (ör. 3 onay); sayı satırdaki rozetle aynı kümedir. */}
                      {totalBadges > 0 ? (
                        <span className={`nav-badge absolute -right-1 -top-1 ${menuTone}`} aria-hidden>
                          {totalBadges > 99 ? "99+" : totalBadges}
                        </span>
                      ) : null}
                    </span>
                    Menü
                  </button>
              );
            }
            const { hub } = slot;
            // Etkin sekme = etkin merkez (alt sayfalar dahil; nav-config ile aynı çözümleme).
            const isActive = hub.id === activeHubId && !active.inDock;
            const slotBadge = hub.id === "bugun" ? urgentNow : hubBadge(hub, badges);
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
                  {/* Yuva sayacı masaüstü satırıyla aynı kuraldadır: sunucu rozeti anında, akışlı sayaç (geciken kira,
                      bugünkü randevu) kendi sınırında; Bugün = acil toplam. */}
                  {counts && (hub.id === "bugun" || !slotBadge) ? (
                    <Suspense fallback={slotBadge ? <SlotBadge signal={slotBadge} /> : null}>
                      <SlotCount hub={hub} badges={badges} counts={counts} />
                    </Suspense>
                  ) : slotBadge ? (
                    <SlotBadge signal={slotBadge} />
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
