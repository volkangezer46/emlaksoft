"use client";

import Link from "@/components/ui/smart-link";
import { Brand } from "@/components/brand/brand";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Lock, Menu, Plus, X } from "lucide-react";
// İkonografi tek kaynaktan: kavramsal ikonlar `src/lib/icons.ts` sözlüğünden gelir.
import { ICONS } from "@/lib/icons";
import { hubNav, resolveActiveHub, type HubPage, type NavHub } from "@/lib/nav-config";
import type { NavBadge, PlanUsageRow } from "@/lib/nav-badges";
import { getHrefStore } from "@/lib/nav-memory";
import { getAppActions } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { MobileNewSheet, mobileNewActions } from "@/components/app/mobile-new-sheet";
import { OfficeStatusChip } from "@/components/app/office-status-chip";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { MenuSearchButton } from "@/components/ui/console/quick-access";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";
import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";
import { announceScope, useNavRole } from "@/lib/ui/use-nav-role";
import { SCOPE_COOKIE, SCOPE_COOKIE_MAX_AGE } from "@/lib/ui/scope";

const VitrinIcon = ICONS.portal;
const ToolsIcon = ICONS.baslikArac;

function isLocked(href: string, lockedHrefs: readonly string[]) {
  return lockedHrefs.some((h) => href === h || href.startsWith(`${h}/`));
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
  scopeCookie = null,
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
  const { navRole, personal } = useNavRole(role, scopeCookie);
  const backToOffice = () => {
    document.cookie = `${SCOPE_COOKIE}=ofis; path=/app; max-age=${SCOPE_COOKIE_MAX_AGE}; samesite=lax`;
    announceScope("ofis");
    router.push("/app?kapsam=ofis");
  };
  // Prefetch: next/link varsayılanı (görünür alanda + hover) yeterli; elle router.prefetch yağmuru kaldırıldı.
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  // Ofisin kapattığı modüller menüden çıkar (veri silinmez).
  const closedModules = useClosedModules();
  const nav = useMemo(() => hubNav(accessibleModules, { role: navRole, closed: closedModules }), [accessibleModules, navRole, closedModules]);
  const active = resolveActiveHub(pathname, nav);
  const activeHubId = active.hub?.id ?? null;

  const closedStore = getHrefStore("closed", storageScope);
  // "closed" deposu menü DURUM kimliklerini tutar: araclar-degisti (Araçlar grubunun varsayılandan ters durumu).
  const stateIds = useSyncExternalStore(closedStore.subscribe, closedStore.read, closedStore.getServerSnapshot);
  const toggleState = (id: string) => {
    const cur = closedStore.read();
    closedStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const toolsOpen = active.inTools || (!simple !== stateIds.includes("araclar-degisti"));

  // Boşta ısıtılan hedefler: merkez girişleri ve alt sabit satırlar (en çok 8); etkin sayfa ve kilitliler atlanır.
  const idleTargets = [...nav.hubs, ...nav.dock].map((h) => h.href).filter((h) => h !== active.pageHref && !isLocked(h, lockedHrefs));
  useIdlePrefetch(idleTargets, 8);

  const creatable = creatableModules ?? accessibleModules;
  const actionsFor = (hub: NavHub) => {
    const owned = hub.pages.map((p) => p.href).filter((h) => h !== "/app");
    return getAppActions(creatable, "", lockedHrefs, closedModules).filter((a) => owned.some((h) => a.href === h || a.href.startsWith(`${h}/`)));
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
            {badge.count > 99 ? "99+" : badge.count}
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

  const renderContent = (variant: "desktop" | "drawer") => (
    <>
      <div className="sb-head flex min-h-11 shrink-0 items-center gap-3 border-b border-white/8 px-4">
        <Brand variant="mark" tone="dark" height={32} alt="" className="rounded-[var(--radius-card)]" />
        <div className="sb-label min-w-0 flex-1">
          <p className="font-display text-base font-extrabold leading-5 text-white">EmlakSoft</p>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--gold-300)]">{navRole === "advisor" || navRole === "team_lead" ? "Danışman konsolu" : "Ofis konsolu"}</p>
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

      <NavScroller label="Uygulama ana menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          <div className="space-y-0.5 pt-1">{nav.hubs.map((hub) => renderHub(hub, {}))}</div>

          {/* Alt sabit: Ayarlar, Abonelik, Yardım (satır bütçesine sayılmaz) + Araçlar (kapalı grup) + Menüyü düzenle. */}
          <div className="mt-3 space-y-0.5 border-t border-white/10 pt-3">
            {nav.dock.map((hub) => renderHub(hub, { dock: true }))}
            {nav.tools.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => toggleState("araclar-degisti")}
                  aria-expanded={toolsOpen}
                  aria-controls="sb-araclar"
                  title="Değerleme, hesaplayıcı, AI asistan ve diğer yardımcı araçlar"
                  className="focus-ring flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-sm text-white/80 transition-colors hover:bg-white/6 hover:text-white lg:min-h-9 touch:min-h-11"
                >
                  <ToolsIcon className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Araçlar</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${toolsOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
                {toolsOpen ? (
                  <div id="sb-araclar" className="space-y-0.5 border-l border-white/10 pl-2 ml-4">
                    {nav.tools.map(renderTool)}
                  </div>
                ) : null}
              </>
            ) : null}
            {/* Menüyü düzenle: kullanılmayan modülleri tek tıkla aç/kapat. Ofis sahibi/genel müdür ofis genelini, diğerleri
                yalnız kendi menüsünü düzenler (yeni sayfa yok; mevcut ayar ekranlarına gider). */}
            <Link
              href={role === "owner" || role === "gm" ? "/app/ayarlar/moduller" : "/app/hesabim?sekme=gorunum"}
              onClick={() => setOpen(false)}
              title="Kullanmadığınız modülleri tek tıkla gizleyin veya açın"
              className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/65 transition-colors hover:bg-white/8 hover:text-white lg:min-h-9"
            >
              <ICONS.moduller className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span>Menüyü düzenle</span>
            </Link>
          </div>
        </div>

        {/* İkon modu (64px): merkez başına tek ikon; hover/odakta sağda sayfa listesi + hızlı eylemler. */}
        <div className="sb-rail space-y-1 pt-3">
          {nav.hubs.map((hub) => {
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
                  aria-label={hub.label}
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

  // Mobil alt çubuk: rol bazlı en çok 5 yuva (nav-roles `mobile`): merkez bağlantıları, "+ Yeni" eylem sayfası, "Menü"
  // çekmecesi. Çekmece masaüstüyle AYNI yapıdır (6 satırlık merkez listesi). Yetkisiz/kapalı merkez yuvası çıkmaz.
  const newActions = useMemo(
    () => mobileNewActions(navRole, creatable, lockedHrefs, closedModules),
    [navRole, creatable, lockedHrefs, closedModules],
  );
  const totalBadges = badges.reduce((n, b) => n + b.count, 0);
  type Slot = { kind: "hub"; hub: NavHub } | { kind: "new" } | { kind: "menu" };
  const slots = nav.mobile.flatMap<Slot>((slot) => {
    if (slot === "menu") return [{ kind: "menu" }];
    if (slot === "new") return newActions.length > 0 ? [{ kind: "new" }] : [];
    const hub = nav.hubs.find((h) => h.id === slot);
    return hub ? [{ kind: "hub", hub }] : [];
  });
  const slotClass = "focus-ring flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs font-semibold leading-tight transition";

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
      <MobileNewSheet open={newOpen} onOpenChange={setNewOpen} actions={newActions} />
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
                  onClick={() => setNewOpen(true)}
                  aria-haspopup="dialog"
                  aria-label="Yeni kayıt ekle"
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
                <DialogTrigger asChild key="menu">
                  <button
                    type="button"
                    aria-label={totalBadges > 0 ? `Menü: tüm sayfalar, ${totalBadges} bekleyen iş` : "Menü: tüm sayfalar"}
                    className={`${slotClass} text-text-faint hover:text-ink-950`}
                  >
                    <span className="relative grid h-7 w-11 place-items-center rounded-full">
                      <Menu className="h-[18px] w-[18px]" aria-hidden />
                      {totalBadges > 0 ? (
                        <span className="nav-badge is-danger absolute -right-0.5 -top-1" aria-hidden>
                          {totalBadges > 99 ? "99+" : totalBadges}
                        </span>
                      ) : null}
                    </span>
                    Menü
                  </button>
                </DialogTrigger>
              );
            }
            const { hub } = slot;
            // Etkin sekme = etkin merkez (alt sayfalar dahil; nav-config ile aynı çözümleme).
            const isActive = hub.id === activeHubId && !active.inDock;
            return (
              <Link
                key={hub.id}
                href={hub.href}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`${slotClass} ${isActive ? "text-brand-600" : "text-text-faint hover:text-ink-950"}`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${isActive ? "bg-brand-600/12" : ""}`}>
                  <hub.icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                {hub.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </Dialog>
  );
}
