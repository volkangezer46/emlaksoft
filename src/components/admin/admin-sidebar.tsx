"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Radar,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  platformModulesFor,
  type PlatformModule,
  type PlatformRole,
} from "@/lib/platform-access";

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
  const allowed = platformModulesFor(role);

  const sections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => allowed.includes(i.module)),
  })).filter((s) => s.items.length > 0);

  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r border-white/6 bg-[linear-gradient(180deg,#0a1224_0%,#050b16_55%,#07101f_100%)] md:flex">
      <div className="relative flex h-14 items-center gap-3 overflow-hidden border-b border-white/8 px-5">
        <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-amber-400/15 blur-2xl" />
        <span className="relative grid h-10 w-10 place-items-center rounded-[12px] bg-amber-400 shadow-[0_0_24px_-4px_rgba(251,191,36,0.65)]">
          <Shield className="h-5 w-5 text-ink-950" />
        </span>
        <div className="relative">
          <p className="font-display text-sm font-extrabold text-white">EmlakSoft</p>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-400">
            <span className="status-pulse h-1.5 w-1.5 rounded-full bg-amber-400" /> {roleLabel}
          </p>
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.title ?? "root"}>
            {section.title ? (
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">{section.title}</p>
            ) : null}
            <nav className="space-y-1">
              {section.items.map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center gap-3 overflow-hidden rounded-[12px] px-3 py-2.5 text-sm transition ${
                      active
                        ? "bg-white/12 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "text-white/75 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    {active ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-amber-400" /> : null}
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-[10px] transition ${
                        active ? "bg-amber-400/20 text-amber-300" : "bg-white/8 text-white/70 group-hover:text-white"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.label}</span>
                      <span className={`text-[11px] font-normal ${active ? "text-white/55" : "text-white/40"}`}>
                        {item.hint}
                      </span>
                    </span>
                    {badge && badge > 0 ? (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
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
        <div className="rounded-[14px] border border-white/8 bg-white/[0.04] p-3">
          <p className="truncate text-xs font-semibold text-white">{staffName}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-amber-400/80">{roleLabel}</p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-mint-400/80">
            <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-400" /> Operasyon oturumu açık
          </div>
        </div>
        <Link href="/app" className="mt-3 block text-[11px] font-semibold text-white/70 transition hover:text-white">
          ← Ofis paneline dön
        </Link>
      </div>
    </aside>
  );
}
