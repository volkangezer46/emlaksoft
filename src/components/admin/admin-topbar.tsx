"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/admin/command-palette";
import { NotificationBell } from "@/components/admin/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { UserMenu } from "@/components/ui/console/user-menu";
import { now } from "@/lib/clock";
import {
  Building2,
  CreditCard,
  Handshake,
  LifeBuoy,
  MapPin,
  Plus,
  Undo2,
  UserRound,
} from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";
import type { FontScale } from "@/lib/font-scale";

const CRUMB: Record<string, string> = {
  admin: "Kontrol paneli",
  satis: "Demo & aday",
  tenants: "Ofisler",
  members: "Üyeler",
  billing: "Abonelik & fatura",
  tickets: "Destek talepleri",
  geo: "Coğrafya",
  sistem: "Sistem sağlığı",
  aktivite: "Aktivite kaydı",
  raporlar: "Raporlar",
  danisman: "Yapay zeka iş danışmanı",
  bildirimler: "Bildirimler",
};

const QUICK: { label: string; href: string; icon: typeof Building2; module: PlatformModule }[] = [
  { label: "Demo & aday", href: "/admin/satis", icon: Handshake, module: "sales" },
  { label: "Ofisler", href: "/admin/tenants", icon: Building2, module: "tenants" },
  { label: "Abonelik & fatura", href: "/admin/billing", icon: CreditCard, module: "billing" },
  { label: "Destek talepleri", href: "/admin/tickets", icon: LifeBuoy, module: "tickets" },
  { label: "Coğrafya", href: "/admin/geo", icon: MapPin, module: "geo" },
];

// Not: `tagline` prop'u alınıyor ama hiçbir yerde render edilmiyordu (h-14
// başlık çubuğunda üçüncü satıra yer yok). Yanıltıcı API yerine kaldırıldı.
export function AdminTopbar({
  roleLabel,
  staffName,
  modules,
  fontScale,
}: {
  roleLabel: string;
  staffName: string;
  modules: PlatformModule[];
  fontScale?: FontScale;
}) {
  const pathname = usePathname();
  const [clock, setClock] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () =>
      setClock(new Date(now()).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setQuickOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const seg = pathname.split("/").filter(Boolean);
  const current = seg.length <= 1 ? "admin" : seg[1]!;
  const title = CRUMB[current] ?? "Platform";
  const quickItems = QUICK.filter((q) => modules.includes(q.module));

  return (
    <header className="glass-bar topbar-platform sticky top-0 z-40 flex h-16 items-center gap-3 pl-16 pr-4 md:px-6">
      {/* Sol: ev ikonlu konum şeridi — platform / rol / sayfa (süper admin ofis uygulamasından ayrışsın) */}
      <Breadcrumb
        className="hidden shrink-0 lg:block"
        home={{ href: "/admin", label: "Kontrol paneli" }}
        items={[{ label: "Platform", href: "/admin" }, { label: roleLabel }, { label: title }]}
      />

      {/* Orta: arama — flex-1 ile boş alanı kapla, çok geniş ekranda okunur genişlikte kal */}
      <div className="mx-auto min-w-0 max-w-2xl flex-1">
        <CommandPalette modules={modules} />
      </div>

      <div className="flex items-center gap-2">
        {quickItems.length > 0 ? (
          <div ref={quickRef} className="relative">
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              aria-expanded={quickOpen}
              aria-haspopup="menu"
              aria-controls="admin-quick-menu"
              className="focus-ring press inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3.5 text-sm font-semibold text-accent-fg shadow-[0_8px_20px_-10px_color-mix(in_srgb,var(--accent)_80%,transparent)] transition-colors hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Hızlı erişim</span>
            </button>
            {quickOpen ? (
              <div id="admin-quick-menu" role="menu" className="absolute right-0 top-11 w-56 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-[0_24px_50px_-20px_rgba(10,34,71,0.5)]">
                {quickItems.map((q) => (
                  <Link
                    key={q.href}
                    href={q.href}
                    role="menuitem"
                    onClick={() => setQuickOpen(false)}
                    className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm text-ink-950 transition hover:bg-canvas"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-canvas text-brand-600">
                      <q.icon className="h-3.5 w-3.5" />
                    </span>
                    {q.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Canlı saat: gerçek canlı gösterge (tek sonsuz nabız istisnası); dakika hassasiyeti. */}
        <span className="hidden h-10 items-center gap-2 rounded-full bg-mint-500/10 px-3 text-sm font-bold tabular-nums text-mint-700 lg:inline-flex" aria-label={clock ? `Saat ${clock}` : undefined}>
          <span className="status-pulse h-2 w-2 rounded-full bg-mint-500" aria-hidden /> {clock}
        </span>

        <ThemeToggle />

        <NotificationBell />

        <UserMenu
          initials={staffName.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toLocaleUpperCase("tr-TR") || "P"}
          name={staffName}
          subtitle={roleLabel}
          fontScale={fontScale}
          links={[
            { href: "/admin/hesabim", label: "Hesabım", icon: UserRound },
            { href: "/app", label: "Ofis paneline dön", icon: Undo2 },
          ]}
        />
      </div>
    </header>
  );
}
