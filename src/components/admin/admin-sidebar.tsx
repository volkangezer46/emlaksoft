"use client";

import Link from "@/components/ui/smart-link";
import { Brand } from "@/components/brand/brand";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Crown, ExternalLink, Globe, Menu, Pin, PinOff, UserRound } from "lucide-react";
import type { AdminHealth } from "@/lib/admin-badges";
import { systemStatusOf } from "@/lib/admin/system-status";
import type { PlatformModule } from "@/lib/platform-access";
import { ADMIN_BADGE_LABEL, ADMIN_BADGE_TONE, type AdminBadgeKey, type AdminNavItem, type AdminNavOverrides, type AdminSidebarGroup } from "@/lib/admin/nav-core";
import type { AdminNavCatalog } from "@/lib/admin/nav-client-catalog";
import { useAdminNav } from "@/components/admin/use-admin-nav";
import { getHrefStore } from "@/lib/nav-memory";
import { SidebarCollapseButton, SidebarCollapseRow } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { QuickAccessSection, useQuickAccess, type QuickItem } from "@/components/ui/console/quick-access";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import { useMobileMenu } from "@/components/app/mobile-menu-trigger";

// Radix Dialog gövdesi (mobil çekmece) yalnız küçük ekranda gerekir: masaüstü kabuk paketine girmez.
const drawerPanel = lazyPanel(() => import("@/components/admin/admin-sidebar-drawer").then((m) => m.AdminSidebarDrawer));
/** Tailwind `md` altı (çekmece kırılımı): yalnız burada boşta önceden yükleme yapılır. */
const SMALL_SCREEN_QUERY = "(max-width: 767.98px)";

type Item = AdminNavItem;
const ADMIN_SCOPE = "admin";

/**
 * Grup başlığı (OFİSLER…): /app menüsüyle aynı küçük büyük harfli başlık + sağda ok; tıklanınca grup satır içinde
 * kapanır/açılır. Varsayılan AÇIK (sahip kararı 2026-10-17: "menüler görünür ve mantıklı olsun").
 */
const GROUP_CLASS = "sb-group sb-group-btn focus-ring flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-3 pt-2 text-left text-xs font-bold uppercase leading-4 tracking-[0.13em] text-white/55 transition-colors hover:text-white max-md:min-h-11 touch:min-h-11";
/** Alt satırlar (Sistem durumu, Siteyi aç, Menüyü daralt): menüyle birlikte kayar, sabit alt bölüm yok. */
const UTIL_ROW_CLASS = "sb-util focus-ring flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-sm text-white/75 transition-colors hover:bg-white/8 hover:text-white lg:min-h-9 touch:min-h-11";

type BadgeCounts = Partial<Record<AdminBadgeKey, number>>;
/** Rozetler sayı ya da söz (promise) olarak gelir: kabuk sayıları BEKLEMEZ, rozet kendi küçük Suspense sınırında akar. */
type BadgesProp = BadgeCounts | Promise<BadgeCounts> | undefined;

const isThenable = (v: unknown): v is Promise<BadgeCounts> => typeof (v as { then?: unknown } | undefined)?.then === "function";

/**
 * Rozet sayısı (söz çözülünce). Sıfır/yoksa hiçbir şey çizmez. Renk kuralı (`ADMIN_BADGE_TONE`): kırmızı = gecikmiş /
 * başarısız, turuncu = karar bekliyor, gri = bilgi.
 */
function BadgeCount({ badges, keys, variant }: { badges: BadgesProp; keys: readonly AdminBadgeKey[]; variant: "pill" | "dot" }) {
  const all = isThenable(badges) ? use(badges) : badges;
  const parts = keys.map((k) => ({ k, n: all?.[k] ?? 0 })).filter((x) => x.n > 0);
  const n = parts.reduce((t, x) => t + x.n, 0);
  if (!(n > 0)) return null;
  const tone = parts.some((x) => ADMIN_BADGE_TONE[x.k] === "danger") ? "danger" : parts.some((x) => ADMIN_BADGE_TONE[x.k] === "warn") ? "warn" : "info";
  const label = parts.map((x) => `${x.n} ${ADMIN_BADGE_LABEL[x.k]}`).join(", ");
  if (variant === "dot") return <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${tone === "danger" ? "bg-danger-400" : tone === "warn" ? "bg-amber-400" : "bg-white/60"}`} aria-hidden />;
  const text = n > 99 ? "99+" : n;
  if (tone === "info") return <span aria-label={label} title={label} className="sb-count pointer-events-none">{text}</span>;
  return (
    <span aria-label={label} title={label} className={`nav-badge pointer-events-none ${tone === "danger" ? "is-danger" : "is-warn"}`}>
      {text}
    </span>
  );
}

function Badge(props: { badges: BadgesProp; keys: readonly AdminBadgeKey[]; variant: "pill" | "dot" }) {
  if (props.keys.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <BadgeCount {...props} />
    </Suspense>
  );
}

/** Menü sonundaki sistem satırı ("Sistem hazır ›"): üst çubuk çipiyle AYNI saf karar (`systemStatusOf`), Sistem durumunu açar. */
function SystemRow({ health, onNavigate }: { health: Promise<AdminHealth | null>; onNavigate: () => void }) {
  const h = use(health);
  if (!h) return null;
  const st = systemStatusOf(h);
  // Dar satır: ayrıntı (ör. "Uyarı kanalı yok · 5 uyarı") başlık ipucunda; satırda kısa durum.
  const label = st.level === "ok" ? "Sistem hazır" : st.level === "warn" ? "Sistem: uyarı var" : "Sistem: sorun var";
  const dot = st.level === "ok" ? "is-ok" : st.level === "warn" ? "is-warn" : "is-down";
  return (
    <Link href="/admin/sistem" data-nav-link onClick={onNavigate} title={`Sistem durumu: ${st.label}`} aria-label={`Sistem durumu: ${st.label}. Ayrıntıyı aç`} className={UTIL_ROW_CLASS}>
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center" aria-hidden>
        <span className={`sb-dot ${dot} m-0`} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
    </Link>
  );
}

export function AdminSidebar({
  staffName,
  modules: allowed,
  roleLabel,
  badges,
  health = null,
  overrides = null,
  catalog,
}: {
  staffName: string;
  /** Personelin görebildiği modüller (sunucuda özel rol dahil hesaplanır: `platformModulesFor(staff)`). */
  modules: readonly PlatformModule[];
  roleLabel: string;
  badges?: BadgesProp;
  /** Sistem sağlığı (yalnız `sistem` modülü olan personelde; 30 sn önbellek): menü sonundaki "Sistem hazır" satırı. */
  health?: Promise<AdminHealth | null> | null;
  /** Menü yönetimi farkı (grup gizle / sırala; platform ayarı). */
  overrides?: AdminNavOverrides | null;
  /** Menü kataloğu (sunucuda düz veri: `adminNavCatalog()`); katalog ve ikonları istemci paketine girmez. */
  catalog: AdminNavCatalog;
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

  // Menü tek kaynaktan (src/lib/admin/nav.ts; kabuk düz veri olarak verir): role göre süzülür; gruplar satır içi açılır alandır (akordeon).
  const { adminNavFor, adminSidebarModel, adminMobileTabs, activeAdminItem } = useAdminNav(catalog);
  const sections = useMemo(() => adminNavFor(allowed, {}, overrides), [adminNavFor, allowed, overrides]);
  const { groups: modelGroups, dock } = useMemo(() => adminSidebarModel(allowed, {}, overrides), [adminSidebarModel, allowed, overrides]);
  // Düzen (referans: emlakfiyati konsolu): ilk grup (Genel bakış) başlıksız en üstte; diğerleri başlıklı ve açık. Alt sabit
  // (dock) öğeler sabit bölümde DEĞİL, son grubun (Yönetim) sonunda normal satırdır; yeni satır/grup verisiyle kendiliğinden yer alır.
  const [topGroup, ...restGroups] = modelGroups;
  const groups = restGroups.map((g, i) => (i === restGroups.length - 1 ? { ...g, items: [...g.items, ...dock] } : g));
  const topItems = topGroup ? (restGroups.length > 0 ? topGroup.items : [...topGroup.items, ...dock]) : dock;
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeItem = activeAdminItem(pathname, sections, sekme);
  const activeHref = activeItem?.href ?? null;
  const isActive = (item: Item) => item.href === activeHref;

  // Grup durumu (localStorage, try/catch store; kullanıcı başına): "c-<grup>" = kapalı. Varsayılan: TÜM gruplar açık
  // (satırlar görünür); kullanıcı başlıktan kapatabilir. Etkin sayfanın grubu her zaman açıktır.
  const stateStore = getHrefStore("closed", ADMIN_SCOPE);
  const state = useSyncExternalStore(stateStore.subscribe, stateStore.read, stateStore.getServerSnapshot);
  const isOpen = (id: string, hasActive: boolean) => hasActive || !state.includes(`c-${id}`);
  const toggle = (id: string, nowOpen: boolean) => {
    const cur = stateStore.read().filter((x) => x !== `o-${id}` && x !== `c-${id}`);
    stateStore.write([...cur, nowOpen ? `c-${id}` : `o-${id}`]);
  };

  const quickItems = useMemo<QuickItem[]>(() => allItems.map((i) => ({ href: i.href, label: i.label, icon: i.icon, description: i.description })), [allItems]);
  const itemByHref = useMemo(() => new Map(allItems.map((i) => [i.href, i])), [allItems]);
  const quick = useQuickAccess({ scope: ADMIN_SCOPE, kind: "admin", items: quickItems, activeHref });

  // Mobil alt gezinme (B145): mobil öncelikli 4 rota (Panel, Ofisler, Talepler, Sistem sabit; rozetliler sonra) + menü çekmecesi.
  const tabItems = useMemo(() => adminMobileTabs(allowed), [adminMobileTabs, allowed]);

  /**
   * Satır (/app menüsüyle aynı dil): ikon + tek satırlık ad (tam ad + açıklama `title`'da) + sağda sayaç. Sekmeler yan
   * menüde TEKRAR EDİLMEZ (sayfanın üstündeki şeritte); üçüncü düzey satır yok.
   */
  const renderItem = (item: Item, opts: { group: string }) => {
    const active = isActive(item);
    const pinned = quick.pins.includes(item.href);
    const keys = item.badgeKey ? [item.badgeKey] : [];
    return (
      <div key={`${opts.group}-${item.href}`} className="nav-item">
        <div className={`group relative flex items-center rounded-[var(--radius-control)] ${active ? "is-active" : ""}`}>
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
            className={`nav-row focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] pl-3 text-sm transition-colors md:min-h-9 lg:min-h-8 touch:min-h-11 ${keys.length ? "pr-12" : "pr-3"} ${
              active ? "nav-pill font-semibold" : "text-white/80 hover:bg-white/6 hover:text-white"
            }`}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </Link>
          <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <button
              type="button"
              aria-pressed={pinned}
              aria-label={pinned ? `${item.label} sabitlemesini kaldır` : `${item.label} sayfasını sabitle`}
              title={pinned ? "Sabitlemeyi kaldır" : "Menüye sabitle"}
              onClick={() => quick.togglePin(item.href)}
              className="nav-pin focus-ring pointer-events-auto grid h-7 w-7 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] text-white/60 hover:bg-white/10 hover:text-white"
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
            </button>
            <span className="mr-1 flex items-center">
              <Badge badges={badges} keys={keys} variant="pill" />
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Grup = akordeon: başlık düğmesi grubu SATIR İÇİNDE açar (üst üste binen açılır pencere yok). Kapalı grupta grubun
  // toplam sayacı başlıkta görünür (rozetli satırlar gizli kalsa da kırmızı/turuncu sinyal kaybolmaz).
  const renderGroup = ({ section, items }: AdminSidebarGroup) => {
    const hasActive = items.some(isActive);
    const expanded = isOpen(section.id, hasActive);
    const keys = items.flatMap((i) => (i.badgeKey ? [i.badgeKey] : []));
    return (
      <div key={section.id}>
        <button
          type="button"
          onClick={() => toggle(section.id, expanded)}
          disabled={hasActive}
          aria-expanded={expanded}
          aria-controls={`adm-${section.id}`}
          className={`${GROUP_CLASS} disabled:cursor-default`}
          title={section.title}
        >
          <span className="min-w-0 flex-1 truncate">{section.title}</span>
          {!expanded ? (
            <span className="relative flex shrink-0 items-center normal-case tracking-normal">
              <Badge badges={badges} keys={keys} variant="pill" />
            </span>
          ) : null}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
          <span className="sr-only">{expanded ? "grubu kapat" : "grubu aç"}</span>
        </button>
        {expanded ? (
          <div id={`adm-${section.id}`} className="mt-0.5 space-y-0.5">
            {items.map((i) => renderItem(i, { group: section.id }))}
          </div>
        ) : null}
      </div>
    );
  };

  const accountActive = pathname.startsWith("/admin/hesabim");
  const renderContent = (variant: "desktop" | "drawer") => (
    <aside className="sb-surface app-sb flex h-full min-h-0 w-full flex-col max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-[env(safe-area-inset-left)] max-md:pt-[env(safe-area-inset-top)]">
      <div className="sb-head relative flex min-h-16 shrink-0 items-center gap-3 border-b border-white/8 px-4 py-3">
        <Brand variant="mark" tone="dark" height={38} alt="" className="rounded-[var(--radius-card)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="truncate font-display text-base font-extrabold leading-5 tracking-tight text-white">EmlakSoft</p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium leading-4 text-white/70 max-[1439px]:hidden">Platform</span>
            <span
              className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--gold-300)]/35 bg-gradient-to-r from-[var(--gold-300)]/20 to-[var(--gold-300)]/5 px-2 py-0.5 text-xs font-semibold leading-4 text-[var(--gold-300)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              title={`${staffName} · ${roleLabel}`}
            >
              <Crown className="h-3 w-3 shrink-0" aria-hidden />
              {/* Dar başlıkta rozet daralma payını alır ve "…" ile biter: daraltma düğmesinin altına taşmaz (title tam adı verir). */}
              <span className="min-w-0 truncate">{roleLabel}</span>
            </span>
          </div>
        </div>
        {/* Daraltılmış rayda genişletme düğmesi; geniş menüde daraltma menü sonundaki "Menüyü daralt" satırındadır. */}
        {variant === "desktop" ? <SidebarCollapseButton className="sb-toggle-head" /> : null}
      </div>

      <NavScroller label="Platform menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          {/* Yalnız kullanıcının sabitledikleri (otomatik "sık kullanılan" kopyası yok: tüm satırlar zaten görünür). */}
          <QuickAccessSection
            pinned={quick.pinned}
            auto={[]}
            hasUsage={false}
            onReset={quick.resetUsage}
            renderRow={(q, kind) => {
              const item = itemByHref.get(q.href);
              return item ? renderItem(item, { group: kind }) : null;
            }}
          />
          {/* İlk grup (Genel bakış: Kontrol paneli, Raporlar, Onaylar, Bildirimler) başlıksız, en üstte. */}
          {topItems.length > 0 ? <div className="space-y-0.5 pt-2">{topItems.map((i) => renderItem(i, { group: topGroup?.section.id ?? "ust" }))}</div> : null}
          <div className="space-y-1">{groups.map(renderGroup)}</div>

          {/* Menü sonu (sabit DEĞİL, listeyle kayar): hesap, sistem durumu, site, menüyü daralt. */}
          <div className="sb-tail mt-3 space-y-0.5 border-t border-white/8 pt-2">
            <div className="nav-item">
              <div className={`group relative flex items-center rounded-[var(--radius-control)] ${accountActive ? "is-active" : ""}`}>
                <Link
                  href="/admin/hesabim"
                  data-nav-link
                  aria-current={accountActive ? "page" : undefined}
                  title="Hesabım · Parola, oturum ve iki adımlı doğrulama"
                  onClick={() => setOpen(false)}
                  className={`nav-row focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors md:min-h-9 lg:min-h-8 touch:min-h-11 ${
                    accountActive ? "nav-pill font-semibold" : "text-white/80 hover:bg-white/6 hover:text-white"
                  }`}
                >
                  <UserRound className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Hesabım</span>
                </Link>
              </div>
            </div>
            {health ? (
              <Suspense fallback={null}>
                <SystemRow health={health} onNavigate={() => setOpen(false)} />
              </Suspense>
            ) : null}
            <a href="/" target="_blank" rel="noopener noreferrer" title="Ana siteyi yeni sekmede aç" className={UTIL_ROW_CLASS}>
              <Globe className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Siteyi aç</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/55" aria-hidden />
              <span className="sr-only">(yeni sekme)</span>
            </a>
            {variant === "desktop" ? <SidebarCollapseRow className={UTIL_ROW_CLASS} /> : null}
          </div>
        </div>

        {/* İkon modu: grup başına ikon kümesi (ince ayraçla); üzerine gelince yalnız ipucu (ad + açıklama), alt pencere yok. */}
        <div className="sb-rail space-y-1 pt-3">
          {[...modelGroups, ...(dock.length ? [{ section: { id: "dock", title: "" }, items: dock }] : [])].map((g, gi) => (
            <div key={g.section.id} className={gi > 0 ? "space-y-1 border-t border-white/8 pt-1" : "space-y-1"}>
              {g.items.map((item) => {
                const active = isActive(item);
                return (
                  <NavFlyout key={item.href} enabled={variant === "desktop"} title={`${item.label} · ${item.description}`} href={item.href}>
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
                      <Badge badges={badges} keys={item.badgeKey ? [item.badgeKey] : []} variant="dot" />
                    </Link>
                  </NavFlyout>
                );
              })}
            </div>
          ))}
          <div className="space-y-1 border-t border-white/8 pt-1">
            <NavFlyout enabled={variant === "desktop"} title="Hesabım" href="/admin/hesabim">
              <Link
                href="/admin/hesabim"
                data-nav-link
                aria-current={accountActive ? "page" : undefined}
                aria-label={`Hesabım: ${staffName}, ${roleLabel}`}
                className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${accountActive ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
              >
                <UserRound className="h-[18px] w-[18px]" aria-hidden />
              </Link>
            </NavFlyout>
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Siteyi aç (yeni sekme)"
              title="Siteyi aç"
              className="focus-ring flex h-11 items-center justify-center rounded-[var(--radius-control)] text-white/70 transition-colors hover:bg-white/8 hover:text-white"
            >
              <Globe className="h-[18px] w-[18px]" aria-hidden />
            </a>
          </div>
        </div>
      </NavScroller>
    </aside>
  );

  return (
    <>
      {/* Masaüstü sabit sidebar */}
      <div className="shell-aside shell-track hidden shrink-0 md:block">
        <div className="shell-aside sticky top-0 h-dvh overflow-hidden">{renderContent("desktop")}</div>
      </div>

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
        className="mbar mbar-dark fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[var(--sb-bg-bottom)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            const active = isActive(tab);
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
