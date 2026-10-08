"use client";

import Link from "@/components/ui/smart-link";
import { Brand } from "@/components/brand/brand";
import { usePathname } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Ellipsis, Lock, Menu, Pin, PinOff, X } from "lucide-react";
// İkonografi tek kaynaktan: kavramsal ikonlar `src/lib/icons.ts` sözlüğünden gelir.
import { ICONS } from "@/lib/icons";
import { itemSubTabs, MOBILE_TAB_SECTIONS, resolveActiveNav, sidebarModel, visibleSections, type NavItem, type SidebarGroup, type VisibleSection } from "@/lib/nav-config";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import { getHrefStore } from "@/lib/nav-memory";
import { findActiveNavigationHref } from "@/lib/navigation";
import { getAppActions } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { OfficeStatusChip } from "@/components/app/office-status-chip";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { MenuSearchButton, QuickAccessSection, useQuickAccess, type QuickItem } from "@/components/ui/console/quick-access";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";

const VitrinIcon = ICONS.portal;

function isLocked(href: string, lockedHrefs: readonly string[]) {
  return lockedHrefs.some((h) => href === h || href.startsWith(`${h}/`));
}

function badgeFor(item: NavItem, badges: readonly NavBadge[]): NavBadge | null {
  return badges.find((b) => item.href === b.itemHref || item.tabs?.some((t) => t.href === b.itemHref)) ?? null;
}

/** Bir başlıktaki öğelerin toplam rozet sayısı: başlık kapalıyken bekleyen iş gözden kaçmaz. */
function groupBadgeCount(items: readonly NavItem[], badges: readonly NavBadge[]) {
  return items.reduce((n, i) => n + (badgeFor(i, badges)?.count ?? 0), 0);
}

/**
 * Akordeon varsayılanı: YALNIZ etkin sayfanın başlığı açık (danışmanda günlük "Bugün" başlığı da açık kalır);
 * kullanıcının değiştirdikleri hatırlanır.
 */
function defaultOpenGroups(role: string | null): readonly string[] {
  return role === "advisor" || role === "team_lead" ? ["bugun"] : [];
}

export function AppSidebar({
  officeName,
  plan,
  trial,
  trialDaysLeft = null,
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
  /** Deneme ofisinde kalan gün (tenants.trial_ends_at); bilinmiyorsa null. */
  trialDaysLeft?: number | null;
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
  /** `${tenantId}:${userId}` — sabitlenen/kullanım/kapalı bölüm tercihlerinin yerel anahtarı. */
  storageScope?: string;
  /** Etkin rol: sade görünümde rol çekirdek menüsünü belirler (yetkiyi değiştirmez). */
  role?: string | null;
  /** Sade görünüm: her başlıkta yalnız rol çekirdeği (bütçe: danışman <= 8, ofis <= 10), gerisi en alttaki kapalı "Diğer" grubunda. */
  simple?: boolean;
}) {
  const pathname = usePathname();
  // Prefetch: next/link varsayılanı (görünür alanda + hover) yeterli; elle router.prefetch yağmuru kaldırıldı.
  const [open, setOpen] = useState(false);

  // Menü 9 iş başlığıdır (bkz. src/lib/nav-config.ts). Başlıkta izinli hiçbir sayfa yoksa gizlenir.
  // Tam liste: etkin sayfa tespiti ve Hızlı erişim için (hiçbir sayfa kaybolmaz).
  // Ofisin kapattığı modüller menüden ve "Diğer" listesinden çıkar (veri silinmez).
  const closedModules = useClosedModules();
  const allSections = useMemo(() => visibleSections(accessibleModules, { closed: closedModules }), [accessibleModules, closedModules]);
  const model = useMemo(
    () => sidebarModel(accessibleModules, { simple, role, closed: closedModules }),
    [simple, accessibleModules, role, closedModules],
  );
  const { section: activeSection, href: activeHref } = resolveActiveNav(pathname, allSections);
  const activeId = activeSection?.id ?? null;
  const activeInRest = model.rest.some((s) => s.items.some((i) => i.href === activeHref));

  const closedStore = getHrefStore("closed", storageScope);
  // "closed" deposu menü DURUM kimliklerini tutar: t-<başlık> (varsayılandan ayrılan başlık), daha-fazla-acik (açık "Diğer").
  const stateIds = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggleState = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const quickItems = useMemo<QuickItem[]>(
    () => allSections.flatMap((s) => s.items).map((i) => ({ href: i.href, label: i.label, icon: i.icon, description: i.description })),
    [allSections],
  );
  const itemByHref = useMemo(() => new Map(allSections.flatMap((s) => s.items).map((i) => [i.href, i])), [allSections]);
  const quick = useQuickAccess({ scope: storageScope, kind: "app", items: quickItems, activeHref });

  const creatable = creatableModules ?? accessibleModules;
  const actionsFor = (section: VisibleSection) => {
    const owned = section.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? [])]).filter((h) => h !== "/app");
    return getAppActions(creatable, "", lockedHrefs, closedModules).filter((a) => owned.some((h) => a.href === h || a.href.startsWith(`${h}/`)));
  };

  const openByDefault = defaultOpenGroups(role);
  const totalBadges = badges.reduce((n, b) => n + b.count, 0);
  const moreOpen = activeInRest || stateIds.includes("daha-fazla-acik");

  const renderItem = (item: NavItem, opts: { group: string; pinnable?: boolean }) => {
    const active = item.href === activeHref;
    const badge = badgeFor(item, badges);
    const pinned = quick.pins.includes(item.href);
    const locked = isLocked(item.href, lockedHrefs);
    // Ana ilke: yan menüde YALNIZ üst düzey sayfa; alt sayfalar/sekmeler sayfa içi şeritte (ikon modu flyout'u hariç).
    const padRight = badge ? "pr-16" : "pr-9";
    const badgeRight = 0.5;
    const pinRight = badge ? 2.25 : 0.25;
    const tip = [item.description ? `${item.label} — ${item.description}` : item.label, item.shortcut ? `(kısayol: ${item.shortcut})` : ""].filter(Boolean).join(" ");
    return (
      <div key={`${opts.group}-${item.href}`}>
        <div className="nav-item group relative">
          <Link
            href={item.href}
            data-nav-link
            data-nav-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
            title={tip}
            onClick={() => setOpen(false)}
            className={`nav-row focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors lg:min-h-9 touch:min-h-11 ${padRight} ${
              active ? "nav-pill font-semibold text-white" : "text-white/80 hover:bg-white/6 hover:text-white"
            }`}
          >
            <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-white/65 group-hover:text-white"}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {locked ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-label="Paketinize dahil değil" /> : null}
          </Link>
          {badge ? (
            <Link
              href={badge.href}
              onClick={() => setOpen(false)}
              aria-label={`${badge.count} ${badge.label}`}
              title={`${badge.count} ${badge.label}`}
              style={{ right: `${badgeRight}rem` }}
              className={`nav-badge absolute top-1/2 -translate-y-1/2 ${badge.tone === "danger" ? "is-danger" : "is-warn"}`}
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
              onClick={() => quick.togglePin(item.href)}
              style={{ right: `${pinRight}rem` }}
              className="nav-pin focus-ring absolute top-1/2 grid h-7 w-7 touch:h-11 touch:w-11 -translate-y-1/2 place-items-center rounded-[var(--radius-control)] text-white/60 hover:bg-white/10 hover:text-white"
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  /** Bir başlığın öğeleri: düz liste (alt grup, ayraç ve alt sayfa yok). */
  const renderItems = (items: readonly NavItem[], group: string) => items.map((i) => renderItem(i, { group, pinnable: true }));

  const groupHeader = (id: string, title: string, opts?: { collapsible?: boolean; expanded?: boolean; badgeCount?: number }) => (
    <div className="sb-eyebrow flex items-center gap-2 px-3 pb-0.5 pt-1.5 text-white/70">
      {opts?.collapsible ? (
        <button
          type="button"
          onClick={() => toggleState(`t-${id}`)}
          aria-expanded={opts.expanded}
          aria-controls={`sb-${id}`}
          title={title}
          className="focus-ring flex min-h-8 touch:min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] text-left uppercase transition-colors hover:text-white"
        >
          <span className="min-w-0 truncate">{title}</span>
          {!opts.expanded && opts.badgeCount ? (
            <span className="nav-badge is-warn" aria-label={`${opts.badgeCount} bekleyen iş`}>{opts.badgeCount > 99 ? "99+" : opts.badgeCount}</span>
          ) : null}
          <span className="h-px min-w-2 flex-1 bg-white/10" aria-hidden />
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${opts.expanded ? "" : "-rotate-90"}`} aria-hidden />
          <span className="sr-only">{opts.expanded ? "bölümü daralt" : "bölümü aç"}</span>
        </button>
      ) : (
        <>
          <span className="min-w-0 truncate uppercase" title={title}>{title}</span>
          <span className="h-px min-w-2 flex-1 bg-white/10" aria-hidden />
        </>
      )}
    </div>
  );

  const renderGroup = (group: SidebarGroup) => {
    const { section, items } = group;
    const isActiveGroup = section.id === activeId;
    // Etkin başlık hep açık; diğerleri varsayılana göre, kullanıcı değiştirdiyse tersine.
    const expanded = isActiveGroup || openByDefault.includes(section.id) !== stateIds.includes(`t-${section.id}`);
    return (
      <div key={section.id}>
        {groupHeader(section.id, section.title, {
          collapsible: !isActiveGroup,
          expanded,
          badgeCount: groupBadgeCount(items, badges),
        })}
        {expanded ? (
          <div id={`sb-${section.id}`} className="space-y-0.5">
            {renderItems(items, section.id)}
          </div>
        ) : null}
      </div>
    );
  };

  const railItems = (items: readonly NavItem[]) =>
    items.map((i) => {
      const sub = itemSubTabs(i);
      const activeSub = sub && i.href === activeHref ? findActiveNavigationHref(pathname, sub.map((t) => t.href), "/app") : null;
      return {
        href: i.href,
        label: i.label,
        icon: i.icon,
        active: i.href === activeHref,
        badge: badgeFor(i, badges),
        children: sub?.map((t) => ({ href: t.href, label: t.label, active: t.href === activeSub })),
      };
    });

  const renderContent = (variant: "desktop" | "drawer") => (
    <>
      <div className="sb-head flex min-h-11 shrink-0 items-center gap-3 border-b border-white/8 px-4">
        <Brand variant="mark" tone="dark" height={32} alt="" className="rounded-[var(--radius-card)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-base font-extrabold leading-5 text-white">EmlakSoft</p>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--gold-300)]">{role === "advisor" || role === "team_lead" ? "Danışman konsolu" : "Ofis konsolu"}</p>
        </div>
        <SidebarCollapseButton />
      </div>

      <MenuSearchButton onActivate={() => setOpen(false)} />

      <NavScroller label="Uygulama ana menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          <QuickAccessSection
            pinned={quick.pinned}
            auto={quick.auto}
            hasUsage={quick.hasUsage}
            onReset={quick.resetUsage}
            renderRow={(q, kind) => {
              const item = itemByHref.get(q.href);
              return item ? renderItem(item, { group: kind, pinnable: true }) : null;
            }}
          />
          {model.groups.map(renderGroup)}
          {model.rest.length > 0 ? (
            <>
              <div className="sb-eyebrow sticky bottom-0 z-[1] bg-[var(--sb-bg-bottom)] px-3 pb-0.5 pt-1 text-white/70 shadow-[0_-8px_12px_-8px_rgba(0,0,0,.6)]">
                <button
                  type="button"
                  onClick={() => toggleState("daha-fazla-acik")}
                  aria-expanded={moreOpen}
                  aria-controls="sb-daha-fazla"
                  className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] text-left uppercase transition-colors hover:text-white"
                >
                  <span className="shrink-0">Diğer</span>
                  <span className="h-px flex-1 bg-white/10" aria-hidden />
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${moreOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
              </div>
              {moreOpen ? (
                <div id="sb-daha-fazla" className="space-y-0.5">
                  {model.rest.map((section) => (
                    <div key={section.id}>
                      <p className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-white/55">{section.title}</p>
                      {renderItems(section.items, `more-${section.id}`)}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* İkon modu (64px): başlık başına tek ikon; hover/odakta sağda alt menü (alt sayfalar dahil) + hızlı eylemler. */}
        <div className="sb-rail space-y-1 pt-3">
          {model.groups.map(({ section, items }) => {
            const active = section.id === activeId;
            const all = items;
            const sectionBadge = groupBadgeCount(all, badges);
            return (
              <NavFlyout
                key={section.id}
                enabled={variant === "desktop"}
                title={section.title}
                href={section.href}
                items={railItems(all)}
                actions={actionsFor({ ...section, items: all })}
              >
                <Link
                  href={section.href}
                  data-nav-link
                  data-nav-active={active ? "true" : undefined}
                  aria-current={active ? "true" : undefined}
                  aria-label={section.title}
                  className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    active ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <section.icon className="h-[18px] w-[18px]" aria-hidden />
                  {sectionBadge > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-400" aria-hidden /> : null}
                </Link>
              </NavFlyout>
            );
          })}
          {model.rest.length > 0 ? (
            <NavFlyout
              enabled={variant === "desktop"}
              title="Diğer"
              items={railItems(model.rest.flatMap((s) => s.items))}
            >
              <Link
                href={model.rest[0]!.href}
                data-nav-link
                data-nav-active={activeInRest ? "true" : undefined}
                aria-current={activeInRest ? "true" : undefined}
                aria-label="Diğer"
                className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                  activeInRest ? "nav-pill text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                }`}
              >
                <Ellipsis className="h-[18px] w-[18px]" aria-hidden />
              </Link>
            </NavFlyout>
          ) : null}
        </div>
      </NavScroller>

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

  // Mobil alt gezinme: 4 ana iş başlığı (Bugün, Müşteriler, Portföy, Anlaşmalar) + "Daha fazla" çekmecesi.
  // Tek kaynak nav-config `MOBILE_TAB_SECTIONS`; sekme başlığın ilk görünen sayfasına gider ve
  // izin/kapalı-modül süzgeci menüyle aynıdır (başlık görünmüyorsa sekme de çıkmaz).
  // Çekmece masaüstüyle AYNI içeriktir (Hızlı erişim en üstte). Hızlı kayıt ("Yeni") üst çubuktaki
  // Yeni menüsünde ve komut paletinde kalır.
  const tabItems = MOBILE_TAB_SECTIONS.flatMap((t) => {
    const section = allSections.find((s) => s.id === t.id);
    return section ? [{ id: t.id, href: section.href, label: t.label, icon: section.icon }] : [];
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-ink-950 text-white shadow-[var(--shadow-card)] lg:hidden" aria-label="Panel menüsünü aç">
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <aside className="shell-aside sb-surface sticky top-0 hidden h-screen shrink-0 flex-col self-start overflow-hidden lg:flex">
        {renderContent("desktop")}
      </aside>
      <DialogDrawerContent id="app-mobile-navigation" aria-describedby={undefined} responsiveClassName="lg:hidden">
        <DialogTitleHidden>Panel menüsü</DialogTitleHidden>
        <aside className="sb-surface flex h-full flex-col">
          <DialogClose asChild>
            <button type="button" className="absolute right-3 top-2 z-10 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80" aria-label="Kapat"><X className="h-5 w-5" /></button>
          </DialogClose>
          {renderContent("drawer")}
        </aside>
      </DialogDrawerContent>
      <nav
        aria-label="Mobil hızlı gezinme"
        // Cam bütçesi: alt çubuk opak (cam yalnız sabit ÜST çubukta; mobil kaydırmada bulanıklık pahalı).
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            // Etkin sekme = etkin iş başlığı (alt sayfalar dahil; nav-config ile aynı çözümleme).
            const active = tab.id === activeId && !activeInRest;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`focus-ring flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap py-2 text-xs font-semibold transition ${
                  active ? "text-brand-600" : "text-text-faint hover:text-ink-950"
                }`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${active ? "bg-brand-600/12" : ""}`}>
                  <tab.icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                {tab.label}
              </Link>
            );
          })}
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={totalBadges > 0 ? `Daha fazla: tüm menü, ${totalBadges} bekleyen iş` : "Daha fazla: tüm menü"}
              className="focus-ring flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold text-text-faint transition hover:text-ink-950"
            >
              <span className="relative grid h-7 w-11 place-items-center rounded-full">
                <Menu className="h-[18px] w-[18px]" aria-hidden />
                {totalBadges > 0 ? (
                  <span className="nav-badge is-danger absolute -right-0.5 -top-1" aria-hidden>
                    {totalBadges > 99 ? "99+" : totalBadges}
                  </span>
                ) : null}
              </span>
              Daha fazla
            </button>
          </DialogTrigger>
        </div>
      </nav>
    </Dialog>
  );
}
