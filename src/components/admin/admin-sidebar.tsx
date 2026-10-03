"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Building2,
  CreditCard,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Megaphone,
  Menu,
  Radar,
  Search,
  Shield,
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
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden, DialogTrigger } from "@/components/ui/dialog";

type Item = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
  module: PlatformModule;
  badgeKey?: "tickets" | "risk" | "trial" | "sales";
};

const SECTIONS: { title: string | null; items: Item[] }[] = [
  {
    title: null,
    items: [
      { href: "/admin", label: "Kontrol paneli", icon: LayoutDashboard, hint: "Canlı metrikler", module: "dashboard" },
    ],
  },
  {
    title: "Satış",
    items: [
      { href: "/admin/satis", label: "Demo & aday", icon: Handshake, hint: "Satış hunisi", module: "sales", badgeKey: "sales" },
    ],
  },
  {
    title: "Operasyon",
    items: [
      { href: "/admin/tenants", label: "Ofisler", icon: Building2, hint: "Ofis envanteri", module: "tenants", badgeKey: "risk" },
      { href: "/admin/members", label: "Üyeler", icon: Users, hint: "Platform kullanıcıları", module: "members" },
      { href: "/admin/personel", label: "Personel", icon: ShieldCheck, hint: "EmlakSoft çalışanları", module: "personel" },
      { href: "/admin/duyuru", label: "Toplu duyuru", icon: Megaphone, hint: "Ofislere mesaj gönder", module: "broadcast" },
      { href: "/admin/geo", label: "Coğrafya", icon: MapPin, hint: "İl · ilçe · mahalle", module: "geo" },
    ],
  },
  {
    title: "Finans",
    items: [
      { href: "/admin/billing", label: "Abonelik & fatura", icon: CreditCard, hint: "MRR & fatura", module: "billing" },
    ],
  },
  {
    title: "Destek",
    items: [
      { href: "/admin/tickets", label: "Destek ticket", icon: LifeBuoy, hint: "Destek kuyruğu", module: "tickets", badgeKey: "tickets" },
    ],
  },
  {
    title: "Analiz",
    items: [
      { href: "/admin/danisman", label: "Yapay zeka danışmanı", icon: Sparkles, hint: "Verilerden içgörü", module: "advisor" },
      { href: "/admin/raporlar", label: "Raporlar", icon: BarChart3, hint: "Platform analizi", module: "reports" },
      { href: "/admin/aktivite", label: "Aktivite kaydı", icon: Activity, hint: "Denetim izi", module: "activity" },
    ],
  },
  {
    title: "Sistem",
    items: [
      { href: "/admin/sistem", label: "Sistem sağlığı", icon: Radar, hint: "Geo, cron, push", module: "sistem" },
    ],
  },
];

export function AdminSidebar({
  staffName,
  role,
  roleLabel,
  badges,
}: {
  staffName: string;
  role: PlatformRole;
  roleLabel: string;
  badges?: { tickets?: number; risk?: number; trial?: number; sales?: number };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allowed = platformModulesFor(role);

  const allSections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => allowed.includes(i.module)),
  })).filter((s) => s.items.length > 0);

  // Menü araması: yalnız izinli modüller üzerinde (etiket + ipucu), Türkçe-duyarlı.
  const needle = query.trim().toLocaleLowerCase("tr-TR");
  const sections = needle
    ? allSections
        .map((s) => ({
          ...s,
          items: s.items.filter((i) => `${i.label} ${i.hint}`.toLocaleLowerCase("tr-TR").includes(needle)),
        }))
        .filter((s) => s.items.length > 0)
    : allSections;

  // Mobil alt gezinme: erişilebilir ilk dört rota + menü çekmecesi.
  const tabItems = allSections.flatMap((s) => s.items).slice(0, 4);

  const content = (
    <aside className="flex h-full w-full flex-col bg-[linear-gradient(180deg,#0a1224_0%,#050b16_55%,#07101f_100%)]">
      <div className="relative flex h-14 items-center gap-3 overflow-hidden border-b border-white/8 px-5">
        <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-amber-400/15 blur-2xl" />
        <span className="relative grid h-10 w-10 place-items-center rounded-[var(--radius-card)] bg-amber-400 shadow-[0_0_24px_-4px_rgba(251,191,36,0.65)]">
          <Shield className="h-5 w-5 text-ink-950" />
        </span>
        <div className="relative">
          <p className="font-display text-sm font-extrabold text-white">EmlakSoft</p>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-400">
            <span className="status-pulse h-1.5 w-1.5 rounded-full bg-amber-400" /> {roleLabel}
          </p>
        </div>
      </div>

      <div className="px-3 pt-3">
        <label className="nav-search">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Menülerde ara…"
            aria-label="Menülerde ara"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="mt-3 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {needle && sections.length === 0 ? (
          <p className="px-3 py-2 text-sm text-white/75">“{query.trim()}” için menü bulunamadı.</p>
        ) : null}
        {sections.map((section) => (
          <div key={section.title ?? "root"}>
            {section.title ? (
              <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/70">{section.title}</p>
            ) : null}
            <nav className="space-y-1">
              {section.items.map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    prefetch
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => router.prefetch(item.href)}
                    onFocus={() => router.prefetch(item.href)}
                    className={`group relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-card)] px-3 py-2.5 text-sm transition ${
                      active
                        ? "nav-gold-active font-semibold"
                        : "text-white/85 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    {active ? <span className="nav-gold-bar absolute inset-y-2 left-0 w-[3px] rounded-r-full" /> : null}
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-[var(--radius-control)] transition ${
                        active ? "bg-[var(--gold-300)]/20 text-[var(--gold-300)]" : "bg-white/8 text-white/70 group-hover:text-white"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.label}</span>
                      <span className={`text-xs font-normal ${active ? "text-white/75" : "text-white/65"}`}>
                        {item.hint}
                      </span>
                    </span>
                    {badge && badge > 0 ? (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                          item.badgeKey === "risk"
                            ? "bg-danger-500/20 text-danger-400"
                            : item.badgeKey === "sales"
                              ? "bg-mint-500/20 text-mint-300"
                              : "bg-amber-400/20 text-amber-300"
                        }`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="border-t border-white/8 p-4">
        <div className="rounded-[var(--radius-card)] border border-white/8 bg-white/[0.04] p-3">
          <p className="truncate text-xs font-semibold text-white">{staffName}</p>
          <p className="mt-0.5 text-xs uppercase tracking-[0.08em] text-amber-400/80">{roleLabel}</p>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-mint-400/80">
            <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-400" /> Operasyon oturumu açık
          </div>
        </div>
        <Link href="/app" onClick={() => setOpen(false)} className="mt-3 block text-xs font-semibold text-white/70 transition hover:text-white">
          ← Ofis paneline dön
        </Link>
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
          className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-amber-400 text-ink-950 shadow-[0_0_24px_-6px_rgba(251,191,36,0.7)] md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>

      {/* Masaüstü sabit sidebar */}
      <div className="hidden w-[264px] shrink-0 border-r border-white/6 md:block">{content}</div>

      {/* Mobil çekmece — focus trap, Escape, scroll lock ve focus restore Radix'ten gelir. */}
      <DialogDrawerContent id="admin-mobile-navigation" aria-describedby={undefined}>
        <DialogTitleHidden>Admin menüsü</DialogTitleHidden>
        <DialogClose asChild>
          <button type="button" className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80" aria-label="Kapat"><X className="h-5 w-5" /></button>
        </DialogClose>
        {content}
      </DialogDrawerContent>

      {/* Mobil alt gezinme */}
      <nav
        aria-label="Admin hızlı gezinme"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[#0a1224]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabItems.length + 1}, minmax(0, 1fr))` }}>
          {tabItems.map((tab) => {
            const active = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-semibold transition ${active ? "text-amber-300" : "text-white/55 hover:text-white"}`}
              >
                <span className={`grid h-7 w-11 place-items-center rounded-full transition ${active ? "bg-amber-400/15" : ""}`}>
                  <tab.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="max-w-full truncate px-0.5">{tab.label}</span>
              </Link>
            );
          })}
          <DialogTrigger asChild>
            <button type="button" className="flex flex-col items-center gap-1 py-2.5 text-xs font-semibold text-white/65 transition hover:text-white">
              <span className="grid h-7 w-11 place-items-center rounded-full"><Menu className="h-[18px] w-[18px]" /></span>
              Menü
            </button>
          </DialogTrigger>
        </div>
      </nav>
    </Dialog>
  );
}
