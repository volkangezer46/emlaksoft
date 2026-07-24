"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  Coins,
  CreditCard,
  Crosshair,
  DoorOpen,
  FileSignature,
  Gauge,
  Handshake,
  Home,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Menu,
  MessageSquare,
  Percent,
  Phone,
  RadioTower,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  UsersRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type { AppModule } from "@/lib/permissions";

const nav: { href: string; label: string; icon: typeof LayoutDashboard; module: AppModule }[] = [
  { href: "/app",              label: "Ana ekran",     icon: LayoutDashboard, module: "dashboard" },
  { href: "/app/musteriler",   label: "Müşteriler",    icon: Users,           module: "customers" },
  { href: "/app/talepler",     label: "Talepler",      icon: Target,          module: "demands" },
  { href: "/app/portfoyler",   label: "Portföyler",    icon: Building2,       module: "properties" },
  { href: "/app/eslestirme",   label: "Eşleştirme",    icon: Crosshair,       module: "matching" },
  { href: "/app/anlasmalar",   label: "Anlaşmalar",    icon: Handshake,       module: "commissions" },
  { href: "/app/teklifler",    label: "Teklifler",     icon: Tag,             module: "offers" },
  { href: "/app/sozlesmeler",  label: "Sözleşmeler",   icon: FileSignature,   module: "contracts" },
  { href: "/app/portallar",    label: "Portal Kontrol",icon: RadioTower,      module: "portals" },
  { href: "/app/kayip-kacak",  label: "Kayıp-kaçak",   icon: Siren,           module: "leak" },
  { href: "/app/kayip-satis",  label: "Kayıp Satış",   icon: TrendingDown,    module: "customers" },
  { href: "/app/kampanyalar",  label: "Kampanyalar",   icon: MessageSquare,   module: "campaigns" },
  { href: "/app/randevular",   label: "Randevular",    icon: CalendarDays,    module: "appointments" },
  { href: "/app/acik-ev",      label: "Açık Ev",       icon: DoorOpen,        module: "open_house" },
  { href: "/app/gorevler",     label: "Görevler",      icon: ListChecks,      module: "tasks" },
  { href: "/app/arama",        label: "Akıllı Arama",  icon: Phone,           module: "calls" },
  { href: "/app/komisyon",     label: "Komisyon",      icon: Wallet,          module: "commissions" },
  { href: "/app/giderler",     label: "Giderler",      icon: Receipt,         module: "expenses" },
  { href: "/app/aidat",        label: "Aidat",         icon: Coins,           module: "expenses" },
  { href: "/app/hedefler",     label: "Hedefler",      icon: TrendingUp,      module: "targets" },
  { href: "/app/danisman-kpi", label: "Danışman KPI",  icon: Trophy,          module: "reports" },
  { href: "/app/otomasyonlar", label: "Otomasyonlar",  icon: Zap,             module: "settings" },
  { href: "/app/raporlar",     label: "Raporlar",      icon: BarChart3,       module: "reports" },
  { href: "/app/degerleme",    label: "Değerleme",     icon: Gauge,           module: "valuation" },
  { href: "/app/kira-artis",   label: "Kira Artışı",   icon: Percent,         module: "valuation" },
  { href: "/app/uyum",         label: "Uyum",          icon: ShieldCheck,     module: "compliance" },
  { href: "/app/denetim",      label: "Denetim",       icon: ScrollText,      module: "settings" },
  { href: "/app/ekip",         label: "Ekip",          icon: UsersRound,      module: "team" },
  { href: "/app/abonelik",     label: "Abonelik",      icon: CreditCard,      module: "billing" },
  { href: "/app/destek",       label: "Destek",        icon: LifeBuoy,        module: "support" },
  { href: "/app/ayarlar",      label: "Ayarlar",       icon: Settings,        module: "settings" },
];

export function AppSidebar({
  officeName,
  plan,
  trial,
  officeScore = null,
  accessibleModules,
}: {
  officeName: string;
  plan: string;
  trial: boolean;
  officeScore?: number | null;
  /** Etkin izinlere göre erişilebilir modüller (bkz. `getEffectivePermissions`, tenant override'larını içerir) */
  accessibleModules: AppModule[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () => nav.filter((item) => accessibleModules.includes(item.module)),
    [accessibleModules],
  );

  const content = (
    <>
      <div className="flex h-17 items-center gap-3 border-b border-white/8 px-5">
        <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[image:var(--grad-brand)] font-display text-base font-extrabold text-white shadow-[0_12px_28px_-12px_rgba(34,211,238,.75)]">E</span>
        <div>
          <p className="font-display text-base font-extrabold text-white">EmlakSoft</p>
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-cyan-400">Command OS</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 text-[9px] font-extrabold uppercase tracking-[.16em] text-white/30">Çalışma alanı</p>
        <nav className="mt-2 space-y-1">
          {items.map((item) => {
            const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                onMouseEnter={() => router.prefetch(item.href)}
                onFocus={() => router.prefetch(item.href)}
                className={`group relative flex items-center gap-3 overflow-hidden rounded-[11px] px-3 py-2.5 text-sm transition ${
                  active ? "bg-white/10 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" : "text-white/52 hover:bg-white/6 hover:text-white"
                }`}
              >
                {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-mint-400" /> : null}
                <span className={`grid h-8 w-8 place-items-center rounded-[9px] transition ${active ? "bg-brand-600 text-white" : "bg-white/5 text-white/55 group-hover:bg-white/10 group-hover:text-cyan-400"}`}>
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="flex-1">{item.label}</span>
                <ChevronRight className={`h-3.5 w-3.5 transition ${active ? "text-mint-400" : "text-white/15 group-hover:translate-x-0.5"}`} />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-3">
        <div className="relative overflow-hidden rounded-[15px] border border-white/10 bg-white/5 p-4">
          <div className="pointer-events-none absolute -right-7 -top-8 h-24 w-24 rounded-full bg-brand-600/25 blur-2xl" />
          <div className="relative flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span className="text-[10px] font-bold uppercase tracking-[.12em] text-amber-400">{trial ? "Deneme alanı" : "Aktif ofis"}</span>
          </div>
          <p className="relative mt-2 truncate text-sm font-bold text-white">{officeName}</p>
          <div className="relative mt-3 flex items-center justify-between">
            <span className="rounded-full bg-mint-400/12 px-2 py-1 text-[10px] font-semibold text-mint-400">{plan}</span>
            <span className="text-[10px] text-white/35">
              {officeScore != null ? `Skor ${officeScore}` : "Skor —"}
            </span>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="fixed left-3 top-3 z-40 grid h-10 w-10 place-items-center rounded-[11px] bg-ink-950 text-white shadow-[var(--shadow-card)] md:hidden" aria-label="Panel menüsünü aç">
        <Menu className="h-5 w-5" />
      </button>
      <aside className="hidden w-[260px] shrink-0 flex-col bg-[linear-gradient(180deg,#071a38_0%,#041127_100%)] md:flex">
        {content}
      </aside>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Menüyü kapat" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink-950/55 backdrop-blur-sm" />
          <aside className="relative flex h-full w-[280px] flex-col bg-[linear-gradient(180deg,#071a38_0%,#041127_100%)] shadow-[var(--shadow-lg)]">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 text-white/70" aria-label="Kapat"><X className="h-5 w-5" /></button>
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
