"use client";

import Link from "next/link";
import { Brand } from "@/components/brand/brand";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ExternalLink, Lock, Menu, Pin, PinOff, Plus, Search, X } from "lucide-react";
// İkonografi tek kaynaktan: kavramsal ikonlar `src/lib/icons.ts` sözlüğünden gelir.
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import { moreSections, resolveActiveNav, visibleSections, type NavItem, type VisibleSection } from "@/lib/nav-config";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import { getHrefStore, MAX_RECENT_SHOWN, pushRecent, togglePin } from "@/lib/nav-memory";
import { getAppActions, OPEN_PALETTE_EVENT } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";
import { ShortcutHint } from "@/components/app/shortcut-hint";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";

const VitrinIcon = ICONS.portal;

function isLocked(href: string, lockedHrefs: readonly string[]) {
  return lockedHrefs.some((h) => href === h || href.startsWith(`${h}/`));
}

function badgeFor(item: NavItem, badges: readonly NavBadge[]): NavBadge | null {
  return badges.find((b) => item.href === b.itemHref || item.tabs?.some((t) => t.href === b.itemHref)) ?? null;
}

export function AppSidebar({
  officeName,
  plan,
  trial,
  accessibleModules,
  creatableModules,
  lockedHrefs = [],
  badges = [],
  usage = [],
  canUpgrade = false,
  vitrinHref = null,
  storageScope,
  role = null,
  simple = false,
}: {
  officeName: string;
  plan: string;
  trial: boolean;
  /** Etkin izinlere göre erişilebilir modüller (bkz. `getEffectivePermissions`, tenant override'larını içerir) */
  accessibleModules: AppModule[];
  /** "create" yetkisi olan modüller (hızlı eylemler yalnız bunlara çıkar). */
  creatableModules?: AppModule[];
  /** Pakete dahil olmayan sayfalar: menüde kilit simgesi, tıklayınca yükseltme sayfası. */
  lockedHrefs?: string[];
  /** Gerçek veriden sayı rozetleri (geciken görev, bekleyen onay). */
  badges?: NavBadge[];
  /** Paket limitine karşı gerçek kullanım; limitsiz kalemler gelmez. */
  usage?: PlanUsageRow[];
  canUpgrade?: boolean;
  vitrinHref?: string | null;
  /** `${tenantId}:${userId}` — sabitlenen/son kullanılan/kapalı bölüm tercihlerinin yerel anahtarı. */
  storageScope?: string;
  /** Etkin rol: sade görünümde rol çekirdek menüsünü belirler (yetkiyi değiştirmez). */
  role?: string | null;
  /** Sade görünüm: yalnız rol çekirdeği, gerisi "Daha fazla" altında. Tercih çerezden SSR'da gelir. */
  simple?: boolean;
}) {
  const pathname = usePathname();
  // Prefetch: next/link varsayılanı (görünür alanda + hover) yeterli; elle router.prefetch yağmuru kaldırıldı.
  const [open, setOpen] = useState(false);

  // Menü 9 iş başlığıdır (bkz. src/lib/nav-config.ts). Başlıkta izinli hiçbir sayfa yoksa gizlenir.
  // Tam liste: etkin sayfa tespiti, sabitlenenler ve son kullanılanlar için (hiçbir sayfa kaybolmaz).
  const allSections = useMemo(() => visibleSections(accessibleModules), [accessibleModules]);
  // Sade görünümde ana liste yalnız çekirdek; çekirdek dışı "Daha fazla" altındadır.
  const sections = useMemo(
    () => (simple ? visibleSections(accessibleModules, { mode: "simple", role }) : allSections),
    [simple, accessibleModules, role, allSections],
  );
  const more = useMemo(() => (simple ? moreSections(accessibleModules, { role }) : []), [simple, accessibleModules, role]);
  const { section: activeSection, href: activeHref } = resolveActiveNav(pathname, allSections);
  const activeId = activeSection?.id ?? null;
  const activeInMore = more.some((s) => s.items.some((i) => i.href === activeHref));

  const pinStore = getHrefStore("pins", storageScope);
  const recentStore = getHrefStore("recent", storageScope);
  const closedStore = getHrefStore("closed", storageScope);
  const pins = useSyncExternalStore(pinStore.subscribe, pinStore.read, pinStore.getServerSnapshot);
  const recents = useSyncExternalStore(recentStore.subscribe, recentStore.read, recentStore.getServerSnapshot);
  const closed = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);

  // Son kullanılanlar: yalnız sayfa yolu. Zaten başta ise yazılmaz (döngü yok).
  useEffect(() => {
    if (!activeHref) return;
    const cur = recentStore.read();
    if (cur[0] !== activeHref) recentStore.write(pushRecent(cur, activeHref));
  }, [activeHref, recentStore]);

  const itemByHref = useMemo(() => new Map(allSections.flatMap((s) => s.items).map((i) => [i.href, i])), [allSections]);
  // Yetki süzgeci: bellekteki yol menüde (yetkili) yoksa görünmez.
  const pinnedItems = pins.flatMap((h) => itemByHref.get(h) ?? []);
  // Son kullanılanlar: tekil, sabitlenmiş/aktif olmayan, aktif başlığın zaten görünen öğeleri hariç; en çok 3 satır.
  const activeSectionHrefs = new Set(sections.find((s) => s.id === activeId)?.items.map((i) => i.href) ?? []);
  const recentItems = [...new Set(recents)]
    .filter((h) => !pins.includes(h) && h !== activeHref && !activeSectionHrefs.has(h))
    .flatMap((h) => itemByHref.get(h) ?? [])
    .slice(0, MAX_RECENT_SHOWN);

  const creatable = creatableModules ?? accessibleModules;
  const actionsFor = (section: VisibleSection) => {
    const owned = section.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? [])]).filter((h) => h !== "/app");
    return getAppActions(creatable, "", lockedHrefs).filter((a) => owned.some((h) => a.href === h || a.href.startsWith(`${h}/`)));
  };

  const totalBadges = badges.reduce((n, b) => n + b.count, 0);

  // "Daha fazla": varsayılan kapalı; kullanıcı açtıysa ya da etkin sayfa içindeyse açık ("closed" deposunda
  // bu kimlik AÇIK anlamına gelir).
  const moreOpen = activeInMore || closed.includes("daha-fazla-acik");
  // "Son kullanılanlar" ve "Kullanım" kartı da varsayılan KAPALI; kimlik depoda varsa AÇIK (aynı desen).
  const recentOpen = closed.includes("son-acik");
  const usageOpen = closed.includes("kullanim-acik");
  const toggleMore = () => {
    const cur = closedStore.read();
    closedStore.write(cur.includes("daha-fazla-acik") ? cur.filter((x) => x !== "daha-fazla-acik") : [...cur, "daha-fazla-acik"]);
  };

  const toggleSection = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const openPalette = () => {
    setOpen(false);
    window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
  };

  const renderItem = (item: NavItem, opts: { group: string; pinnable?: boolean }) => {
    const active = item.href === activeHref;
    const badge = badgeFor(item, badges);
    const pinned = pins.includes(item.href);
    const locked = isLocked(item.href, lockedHrefs);
    return (
      <div key={`${opts.group}-${item.href}`} className="nav-item group relative">
        <Link
          href={item.href}
          data-nav-link
          data-nav-active={active ? "true" : undefined}
          aria-current={active ? "page" : undefined}
          title={item.label}
          onClick={() => setOpen(false)}
          className={`nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors lg:min-h-8 ${
            badge ? "pr-16" : "pr-9"
          } ${active ? "nav-pill font-semibold text-white" : "text-white/80 hover:bg-white/6 hover:text-white"}`}
        >
          <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[var(--gold-300)]" : "text-white/65 group-hover:text-white"}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {locked ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
        </Link>
        {badge ? (
          <Link
            href={badge.href}
            onClick={() => setOpen(false)}
            aria-label={`${badge.count} ${badge.label}`}
            title={`${badge.count} ${badge.label}`}
            className={`nav-badge absolute right-2 top-1/2 -translate-y-1/2 ${badge.tone === "danger" ? "is-danger" : "is-warn"}`}
          >
            {badge.count > 99 ? "99+" : badge.count}
          </Link>
        ) : null}
        {opts.pinnable || pinned ? (
          <button
            type="button"
            aria-pressed={pinned}
            aria-label={pinned ? `${item.label} sabitlemesini kaldır` : `${item.label} sayfasını sabitle`}
            title={pinned ? "Sabitlemeyi kaldır" : "Menüye sabitle"}
            onClick={() => pinStore.write(togglePin(pinStore.read(), item.href))}
            className={`nav-pin focus-ring absolute top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[var(--radius-control)] text-white/60 hover:bg-white/10 hover:text-white ${
              badge ? "right-9" : "right-1"
            }`}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
          </button>
        ) : null}
      </div>
    );
  };

  const groupHeader = (id: string, title: string, opts?: { collapsible?: boolean; expanded?: boolean }) => (
    <div className="sb-eyebrow flex items-center gap-2 px-3 pb-0.5 pt-1.5 text-white/70">
      {opts?.collapsible ? (
        <button
          type="button"
          onClick={() => toggleSection(id)}
          aria-expanded={opts.expanded}
          aria-controls={`sb-${id}`}
          className="focus-ring flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] text-left uppercase transition-colors hover:text-white"
        >
          <span className="shrink-0">{title}</span>
          <span className="h-px flex-1 bg-white/10" aria-hidden />
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${opts.expanded ? "" : "-rotate-90"}`} aria-hidden />
          <span className="sr-only">{opts.expanded ? "bölümü daralt" : "bölümü aç"}</span>
        </button>
      ) : (
        <>
          <span className="shrink-0 uppercase">{title}</span>
          <span className="h-px flex-1 bg-white/10" aria-hidden />
        </>
      )}
    </div>
  );

  const renderContent = (variant: "desktop" | "drawer") => (
    <>
      <div className="sb-head flex min-h-11 shrink-0 items-center gap-3 border-b border-white/8 px-4">
        <Brand variant="mark" tone="dark" height={32} alt="" className="rounded-[var(--radius-card)] shadow-[0_12px_28px_-12px_rgba(34,211,238,.75)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-base font-extrabold leading-5 text-white">EmlakSoft</p>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--gold-300)]">Ofis konsolu</p>
        </div>
        <SidebarCollapseButton />
      </div>

      <div className={`sb-pad px-3 pt-1.5${simple && variant === "desktop" ? " hidden" : ""}`}>
        <button
          type="button"
          onClick={openPalette}
          aria-label="Ara: müşteri, portföy, ilan no veya sayfa"
          title="Ara"
          className="nav-search focus-ring w-full text-left transition-colors hover:bg-white/10"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sb-label flex-1 truncate text-sm text-white/75">Ad, telefon veya ilan no ara…</span>
          <ShortcutHint className="sb-label rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 font-sans text-xs font-semibold text-white/80" />
        </button>
      </div>

      <NavScroller label="Uygulama ana menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          {pinnedItems.length > 0 ? (
            <div>
              {groupHeader("sabit", "Sabitlenenler")}
              <div className="space-y-0.5">{pinnedItems.map((i) => renderItem(i, { group: "pin", pinnable: true }))}</div>
            </div>
          ) : null}
          {recentItems.length > 0 ? (
            <div>
              {groupHeader("son-acik", "Son kullanılanlar", { collapsible: true, expanded: recentOpen })}
              {recentOpen ? (
                <div id="sb-son-acik" className="space-y-0.5">{recentItems.map((i) => renderItem(i, { group: "recent", pinnable: true }))}</div>
              ) : null}
            </div>
          ) : null}
          {sections.map((section) => {
            const expanded = section.id === activeId || !closed.includes(section.id);
            return (
              <div key={section.id}>
                {groupHeader(section.id, section.title, { collapsible: section.id !== activeId, expanded })}
                {expanded ? (
                  <div id={`sb-${section.id}`} className="space-y-0.5">
                    {section.items.map((i) => renderItem(i, { group: section.id, pinnable: true }))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {more.length > 0 ? (
            <>
              <div className="sb-eyebrow sticky bottom-0 z-[1] bg-[#0a111e] px-3 pb-0.5 pt-1 text-white/70 shadow-[0_-8px_12px_-8px_rgba(0,0,0,.6)]">
                <button
                  type="button"
                  onClick={toggleMore}
                  aria-expanded={moreOpen}
                  aria-controls="sb-daha-fazla"
                  className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] text-left uppercase transition-colors hover:text-white"
                >
                  <span className="shrink-0">Daha fazla</span>
                  <span className="h-px flex-1 bg-white/10" aria-hidden />
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${moreOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
              </div>
              {moreOpen ? (
                <div id="sb-daha-fazla" className="space-y-0.5">
                  {more.map((section) => (
                    <div key={section.id}>
                      <p className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-white/55">{section.title}</p>
                      {section.items.map((i) => renderItem(i, { group: `more-${section.id}`, pinnable: true }))}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* İkon modu (64px): başlık başına tek ikon; hover/odakta sağda alt menü + hızlı eylemler. */}
        <div className="sb-rail space-y-1 pt-3">
          {sections.map((section) => {
            const active = section.id === activeId;
            const sectionBadge = section.items.reduce((n, i) => n + (badgeFor(i, badges)?.count ?? 0), 0);
            return (
              <NavFlyout
                key={section.id}
                enabled={variant === "desktop"}
                title={section.title}
                href={section.href}
                items={section.items.map((i) => ({
                  href: i.href,
                  label: i.label,
                  icon: i.icon,
                  active: i.href === activeHref,
                  badge: badgeFor(i, badges),
                }))}
                actions={actionsFor(section)}
              >
                <Link
                  href={section.href}
                  data-nav-link
                  data-nav-active={active ? "true" : undefined}
                  aria-current={active ? "true" : undefined}
                  aria-label={section.title}
                  className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    active ? "nav-pill text-[var(--gold-300)]" : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <section.icon className="h-[18px] w-[18px]" aria-hidden />
                  {sectionBadge > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-400" aria-hidden /> : null}
                </Link>
              </NavFlyout>
            );
          })}
        </div>
      </NavScroller>

      <div className="sb-pad space-y-0.5 border-t border-white/8 px-3 py-1.5">
        <div
          className="sb-when-collapsed mx-auto h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-white/10 bg-white/8 font-display text-sm font-extrabold text-[var(--gold-300)]"
          title={`${officeName} · ${plan}`}
          role="img"
          aria-label={`${officeName}, ${plan} paketi`}
        >
          {officeName.trim().charAt(0).toLocaleUpperCase("tr-TR") || "E"}
        </div>

        <div className="sb-label rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-0.5">
          <button
            type="button"
            onClick={() => toggleSection("kullanim-acik")}
            aria-expanded={usageOpen}
            aria-controls="sb-kullanim"
            title={`${officeName} · kullanım ayrıntısı`}
            className="focus-ring flex min-h-8 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] text-left"
          >
            <span className="sb-eyebrow min-w-0 flex-1 truncate uppercase text-white/75">Kullanım</span>
            <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--gold-300)]">
              {trial ? "Deneme" : plan}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-white/70 transition-transform ${usageOpen ? "" : "-rotate-90"}`} aria-hidden />
          </button>
          {usageOpen ? (
          <div id="sb-kullanim" className="pb-1.5">
          <p className="mt-1 truncate text-sm font-semibold text-white">{officeName}</p>
          {usage.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {usage.map((u) => {
                const ratio = u.limit > 0 ? Math.min(1, u.used / u.limit) : 0;
                const tone = ratio >= 0.9 ? "bg-danger-400" : ratio >= 0.75 ? "bg-amber-400" : "bg-mint-400";
                return (
                  <li key={u.key}>
                    <Link href={u.href} onClick={() => setOpen(false)} className="focus-ring group block rounded-[var(--radius-control)]">
                      <span className="flex items-center justify-between text-xs">
                        <span className="text-white/80 group-hover:text-white">{u.label}</span>
                        <span className="num text-white/90">
                          {u.used.toLocaleString("tr-TR")} / {u.limit.toLocaleString("tr-TR")}
                        </span>
                      </span>
                      <span
                        className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/10"
                        role="meter"
                        aria-label={`${u.label} kullanımı`}
                        aria-valuemin={0}
                        aria-valuemax={u.limit}
                        aria-valuenow={Math.min(u.used, u.limit)}
                      >
                        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(ratio * 100, u.used > 0 ? 3 : 0)}%` }} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-white/70">Paketinizde sayılı kullanım sınırı yok.</p>
          )}
          {canUpgrade ? (
            <Link
              href="/app/abonelik"
              onClick={() => setOpen(false)}
              className="focus-ring mt-3 flex min-h-9 items-center justify-center rounded-[var(--radius-control)] bg-white/10 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/16"
            >
              Paketi yükselt
            </Link>
          ) : null}
          </div>
          ) : null}
        </div>

        {vitrinHref ? (
          <a
            href={vitrinHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Ofis vitrinini yeni sekmede aç"
            className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white lg:min-h-8"
          >
            <VitrinIcon className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
            <span className="sb-label flex-1 truncate">Vitrini görüntüle</span>
            <ExternalLink className="sb-label h-3.5 w-3.5 shrink-0 text-white/60" aria-hidden />
          </a>
        ) : null}
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
  // "Yeni": sahada hızlı kayıt sayfası (müşteri / görüşme / randevu); en az birine create izni gerekir.
  const showQuickNew = ["customers", "calls", "appointments"].some((m) => creatable.includes(m as AppModule));
  const quickActive = pathname === "/app/hizli";
  const activeTabHref = findActiveNavigationHref(
    pathname,
    tabItems.map((item) => item.href),
    "/app",
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-ink-950 text-white shadow-[var(--shadow-card)] lg:hidden" aria-label="Panel menüsünü aç">
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <aside className="shell-aside sticky top-0 hidden h-screen shrink-0 flex-col self-start overflow-hidden bg-[linear-gradient(180deg,#0b1220_0%,#070d19_100%)] lg:flex">
        {renderContent("desktop")}
      </aside>
      <DialogDrawerContent id="app-mobile-navigation" aria-describedby={undefined} responsiveClassName="lg:hidden">
        <DialogTitleHidden>Panel menüsü</DialogTitleHidden>
        <aside className="flex h-full flex-col bg-[linear-gradient(180deg,#0b1220_0%,#070d19_100%)]">
          <DialogClose asChild>
            <button type="button" className="absolute right-3 top-2 z-10 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80" aria-label="Kapat"><X className="h-5 w-5" /></button>
          </DialogClose>
          {renderContent("drawer")}
        </aside>
      </DialogDrawerContent>
      <nav
        aria-label="Mobil hızlı gezinme"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1 + (showQuickNew ? 1 : 0)}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            const active = tab.href === activeTabHref;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap py-2 text-xs font-semibold transition ${
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
          {showQuickNew ? (
            <Link
              href="/app/hizli"
              aria-current={quickActive ? "page" : undefined}
              aria-label="Yeni kayıt: hızlı kayıt"
              onClick={() => setOpen(false)}
              className="flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold text-brand-600 transition"
            >
              <span className={`grid h-7 w-11 place-items-center rounded-full bg-brand-600 text-white ${quickActive ? "ring-2 ring-brand-300" : ""}`}>
                <Plus className="h-[18px] w-[18px]" />
              </span>
              Yeni
            </Link>
          ) : null}
          <DialogTrigger asChild>
            <button type="button" className="flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold text-text-faint transition hover:text-ink-950">
              <span className="relative grid h-7 w-11 place-items-center rounded-full">
                <Menu className="h-[18px] w-[18px]" />
                {totalBadges > 0 ? (
                  <span className="nav-badge is-danger absolute -right-0.5 -top-1" aria-label={`${totalBadges} bekleyen iş`}>
                    {totalBadges > 99 ? "99+" : totalBadges}
                  </span>
                ) : null}
              </span>
              Menü
            </button>
          </DialogTrigger>
        </div>
      </nav>
    </Dialog>
  );
}
