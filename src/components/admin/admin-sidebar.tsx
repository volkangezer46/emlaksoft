"use client";

import Link from "next/link";
import { Brand } from "@/components/brand/brand";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  Activity,
  BarChart3,
  Building2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Globe,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Megaphone,
  Menu,
  Radar,
  Search,
  SearchCheck,
  Palette,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import {
  platformModulesFor,
  type PlatformModule,
  type PlatformRole,
} from "@/lib/platform-access";
import type { AdminHealth } from "@/lib/admin-badges";
import { getHrefStore } from "@/lib/nav-memory";
import { OPEN_PALETTE_EVENT } from "@/lib/palette-core";
import { SidebarCollapseButton } from "@/components/ui/console/sidebar-collapse";
import { NavFlyout, NavScroller } from "@/components/ui/console/nav-kit";
import { KbdCombo } from "@/components/ui/kbd";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";

type Item = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
  module: PlatformModule;
  badgeKey?: "tickets" | "risk" | "trial" | "sales";
};

const SECTIONS: { id: string; title: string | null; items: Item[] }[] = [
  {
    id: "genel",
    title: null,
    items: [
      { href: "/admin", label: "Kontrol paneli", icon: LayoutDashboard, hint: "Canlı metrikler", module: "dashboard" },
    ],
  },
  {
    id: "satis",
    title: "Satış",
    items: [
      { href: "/admin/satis", label: "Demo & aday", icon: Handshake, hint: "Satış hunisi", module: "sales", badgeKey: "sales" },
    ],
  },
  {
    id: "operasyon",
    title: "Operasyon",
    items: [
      { href: "/admin/tenants", label: "Ofisler", icon: Building2, hint: "Ofis envanteri", module: "tenants", badgeKey: "risk" },
      { href: "/admin/tenants/yeni", label: "Yeni ofis", icon: Building2, hint: "Ofis aç ve sahibine erişim ver", module: "sales" },
      { href: "/admin/members", label: "Üyeler", icon: Users, hint: "Platform kullanıcıları", module: "members" },
      { href: "/admin/personel", label: "Personel", icon: ShieldCheck, hint: "EmlakSoft çalışanları", module: "personel" },
      { href: "/admin/duyuru", label: "Toplu duyuru", icon: Megaphone, hint: "Ofislere mesaj gönder", module: "broadcast" },
      { href: "/admin/geo", label: "Coğrafya", icon: MapPin, hint: "İl · ilçe · mahalle", module: "geo" },
    ],
  },
  {
    id: "finans",
    title: "Finans",
    items: [
      { href: "/admin/billing", label: "Abonelik & fatura", icon: CreditCard, hint: "MRR & fatura", module: "billing" },
    ],
  },
  {
    id: "destek",
    title: "Destek",
    items: [
      { href: "/admin/tickets", label: "Destek ticket", icon: LifeBuoy, hint: "Destek kuyruğu", module: "tickets", badgeKey: "tickets" },
    ],
  },
  {
    id: "analiz",
    title: "Analiz",
    items: [
      { href: "/admin/danisman", label: "Yapay zeka danışmanı", icon: Sparkles, hint: "Verilerden içgörü", module: "advisor" },
      { href: "/admin/raporlar", label: "Raporlar", icon: BarChart3, hint: "Platform analizi", module: "reports" },
      { href: "/admin/aktivite", label: "Aktivite kaydı", icon: Activity, hint: "Denetim izi", module: "activity" },
    ],
  },
  {
    id: "sistem",
    title: "Sistem",
    items: [
      { href: "/admin/sistem", label: "Sistem sağlığı", icon: Radar, hint: "Geo, cron, push", module: "sistem" },
      { href: "/admin/marka", label: "Marka", icon: Palette, hint: "Logo ve favicon", module: "marka" },
      { href: "/admin/seo", label: "SEO merkezi", icon: SearchCheck, hint: "Arama motoru, sitemap, robot", module: "seo" },
    ],
  },
];

const isActive = (pathname: string, href: string) =>
  href === "/admin"
    ? pathname === "/admin"
    : href === "/admin/tenants"
      ? pathname.startsWith(href) && !pathname.startsWith("/admin/tenants/yeni")
      : pathname.startsWith(href);

export function AdminSidebar({
  staffName,
  role,
  roleLabel,
  badges,
  health = null,
}: {
  staffName: string;
  role: PlatformRole;
  roleLabel: string;
  badges?: { tickets?: number; risk?: number; trial?: number; sales?: number };
  /** Ölçülen gerçek sağlık verisi; yoksa (veya rol "sistem" göremiyorsa) kart gösterilmez. */
  health?: AdminHealth | null;
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

  const sections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => allowed.includes(i.module)),
  })).filter((s) => s.items.length > 0);

  // Mobil alt gezinme: erişilebilir ilk dört rota + menü çekmecesi.
  const tabItems = sections.flatMap((s) => s.items).slice(0, 4);
  const allItems = sections.flatMap((s) => s.items);

  const renderItem = (item: Item) => {
    const active = isActive(pathname, item.href);
    const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
    return (
      <div key={item.href} className="nav-item group relative">
        <Link
          href={item.href}
          data-nav-link
          data-nav-active={active ? "true" : undefined}
          aria-current={active ? "page" : undefined}
          title={`${item.label} · ${item.hint}`}
          prefetch
          onClick={() => setOpen(false)}
          onMouseEnter={() => router.prefetch(item.href)}
          onFocus={() => router.prefetch(item.href)}
          className={`focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors md:min-h-10 ${
            badge && badge > 0 ? "pr-12" : "pr-3"
          } ${active ? "nav-pill font-semibold text-white" : "text-white/80 hover:bg-white/6 hover:text-white"}`}
        >
          <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[var(--gold-300)]" : "text-white/65 group-hover:text-white"}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </Link>
        {badge && badge > 0 ? (
          <span
            aria-label={`${badge} bekleyen`}
            className={`nav-badge pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${item.badgeKey === "sales" ? "is-ok" : item.badgeKey === "risk" ? "is-danger" : "is-warn"}`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </div>
    );
  };

  const issues = health ? !health.ok || (health.cronErrors ?? 0) > 0 : false;

  const renderContent = (variant: "desktop" | "drawer") => (
    <aside className="flex h-full w-full flex-col bg-[linear-gradient(180deg,#0b1220_0%,#070d19_100%)]">
      <div className="sb-head relative flex min-h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-white/8 px-4">
        <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-amber-400/15 blur-2xl" />
        <Brand variant="mark" tone="dark" height={36} alt="" className="relative rounded-[var(--radius-card)] shadow-[0_0_24px_-4px_rgba(251,191,36,0.65)]" />
        <div className="sb-label relative min-w-0 flex-1">
          <p className="truncate font-display text-sm font-extrabold leading-5 text-white">EmlakSoft Platform</p>
          <p className="truncate text-xs font-bold uppercase tracking-[0.12em] text-[var(--gold-300)]">{roleLabel}</p>
        </div>
        <SidebarCollapseButton className="relative" />
      </div>

      <div className="sb-pad px-3 pt-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
          }}
          aria-label="Ara ve komut paletini aç (Ctrl K)"
          title="Ara (Ctrl K)"
          className="nav-search focus-ring w-full text-left transition-colors hover:bg-white/10"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sb-label flex-1 truncate text-sm text-white/75">Ara…</span>
          <KbdCombo keys={["mod", "K"]} className="sb-label !border-white/15 !bg-white/8 !text-white/80" />
        </button>
      </div>

      <NavScroller label="Platform menüsü" className="sb-pad flex-1 px-3" innerClassName="pb-3">
        <div className="sb-expanded">
          {sections.map((section) => {
            const hasActive = section.items.some((i) => isActive(pathname, i.href));
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
            const active = isActive(pathname, item.href);
            const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
            return (
              <NavFlyout
                key={item.href}
                enabled={variant === "desktop"}
                title={`${item.label} · ${item.hint}`}
                href={item.href}
              >
                <Link
                  href={item.href}
                  data-nav-link
                  data-nav-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`focus-ring relative flex h-11 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
                    active ? "nav-pill text-[var(--gold-300)]" : "text-white/70 hover:bg-white/8 hover:text-white"
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

        {health ? (
          <Link
            href="/admin/sistem"
            onClick={() => setOpen(false)}
            className="sb-label focus-ring block rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/8"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="sb-eyebrow uppercase text-white/75">Sistem</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-[0.06em] ${
                  issues ? "border-amber-400/40 text-amber-300" : "border-mint-400/40 text-mint-300"
                }`}
              >
                {issues ? "Dikkat" : "Canlı"}
              </span>
            </span>
            <span className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
              <span className={`h-2 w-2 shrink-0 rounded-full ${issues ? "bg-amber-400" : "bg-mint-400"}`} aria-hidden />
              {health.ok ? "Veritabanı yanıt veriyor" : "Veritabanı sorgusu hata verdi"}
            </span>
            <span className="num mt-1 block text-xs text-white/70">
              {health.dbMs} ms
              {health.cronTotal != null
                ? ` · ${health.cronTotal} cron işi${(health.cronErrors ?? 0) > 0 ? `, ${health.cronErrors} hatalı` : " hatasız"}`
                : ""}
            </span>
            {health.failedJobs && health.failedJobs.length > 0 ? (
              <span className="mt-1 block truncate text-xs text-amber-300" title={health.failedJobs.join(", ")}>
                Hatalı: {health.failedJobs.join(", ")}
              </span>
            ) : null}
            {health.unknownJobs && health.unknownJobs.length > 0 ? (
              <span className="mt-1 block truncate text-xs text-white/50" title={health.unknownJobs.join(", ")}>
                Tanımsız iş (eski kayıt): {health.unknownJobs.join(", ")}
              </span>
            ) : null}
          </Link>
        ) : null}

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
          className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-amber-400 text-ink-950 shadow-[0_0_24px_-6px_rgba(251,191,36,0.7)] md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>

      {/* Masaüstü sabit sidebar */}
      <div className="shell-aside sticky top-0 hidden h-screen shrink-0 self-start overflow-hidden border-r border-white/6 md:block">{renderContent("desktop")}</div>

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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[#0a1224] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs font-semibold transition ${active ? "text-amber-300" : "text-white/70 hover:text-white"}`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${active ? "bg-amber-400/15" : ""}`}>
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
