"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { CommandPalette } from "@/components/admin/command-palette";
import { NotificationBell } from "@/components/admin/notification-bell";
import {
  Building2,
  CreditCard,
  Handshake,
  LifeBuoy,
  LogOut,
  MapPin,
  Plus,
  Radio,
} from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";

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

export function AdminTopbar({
  roleLabel,
  tagline,
  modules,
}: {
  roleLabel: string;
  tagline: string;
  modules: PlatformModule[];
}) {
  const pathname = usePathname();
  const [clock, setClock] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setQuickOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const seg = pathname.split("/").filter(Boolean);
  const current = seg.length <= 1 ? "admin" : seg[1]!;
  const title = CRUMB[current] ?? "Platform";
  const quickItems = QUICK.filter((q) => modules.includes(q.module));

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line/80 bg-surface/85 px-4 backdrop-blur-xl md:px-6">
      {/* Sol: logo + başlık — sabit genişlik */}
      <div className="flex w-52 shrink-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-amber-400/15 text-amber-600">
          <Radio className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-600">
            EmlakSoft · {roleLabel}
          </p>
          <p className="truncate text-sm font-semibold text-ink-950">
            {title}
          </p>
        </div>
      </div>

      {/* Orta: arama — flex-1 ile tüm boş alanı kapla */}
      <div className="hidden flex-1 md:block">
        <CommandPalette modules={modules} />
      </div>

      <div className="flex items-center gap-2">
        {quickItems.length > 0 ? (
          <div ref={quickRef} className="relative">
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[image:var(--grad-brand)] px-3 py-2 text-xs font-bold text-white shadow-[0_8px_20px_-8px_rgba(20,99,255,0.7)] transition hover:brightness-105"
            >
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Hızlı erişim</span>
            </button>
            {quickOpen ? (
              <div className="absolute right-0 top-11 w-56 overflow-hidden rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_24px_50px_-20px_rgba(10,34,71,0.5)]">
                {quickItems.map((q) => (
                  <Link
                    key={q.href}
                    href={q.href}
                    onClick={() => setQuickOpen(false)}
                    className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-ink-950 transition hover:bg-canvas"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-canvas text-brand-600">
                      <q.icon className="h-3.5 w-3.5" />
                    </span>
                    {q.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <span className="hidden items-center gap-1.5 rounded-full bg-mint-500/10 px-2.5 py-1 text-[10px] font-bold text-mint-600 lg:inline-flex">
          <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" /> {clock}
        </span>

        <NotificationBell />

        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500"
          >
            <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Çıkış</span>
          </button>
        </form>
      </div>
    </header>
  );
}
