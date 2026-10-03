"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Building2,
  ChevronDown,
  HelpCircle,
  Landmark,
  LifeBuoy,
  Menu,
  PhoneIncoming,
  Radar,
  Scale,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Wallet,
  Workflow,
  X,
} from "lucide-react";
import { getPlan } from "@/lib/billing/plans";

type Icon = React.ComponentType<{ className?: string }>;
type MenuItem = { icon: Icon; title: string; desc: string; href: string };

const product: MenuItem[] = [
  { icon: Radar, title: "Kayıp-kaçak motoru", desc: "İlan düşünce nedeni sorulur, kaçan komisyon görünür", href: "/#kayip-kacak" },
  { icon: PhoneIncoming, title: "Akıllı Arama", desc: "Telefon çalarken müşteri kartı ve eşleşen portföy", href: "/#akilli-arama" },
  { icon: TrendingUp, title: "Değerleme", desc: "Emsal motoruyla fiyat aralığı sinyali", href: "/#ozellikler" },
  { icon: Wallet, title: "Komisyon defteri", desc: "Bölüşüm ve hakediş kayıt altında", href: "/#ozellikler" },
  { icon: Scale, title: "KVKK, İYS ve EİDS", desc: "Mevzuat adımları görünür süreçlerde", href: "/#guvenlik" },
  { icon: Building2, title: "Portal kontrolü", desc: "İlan no/URL ile teyit ve kapanış takibi", href: "/#portallar" },
];

const solutions: MenuItem[] = [
  { icon: UserRound, title: "Bağımsız danışman", desc: `${getPlan("advisor").limits.seats} kullanıcı · ${getPlan("advisor").limits.branches} şube`, href: "/kayit?plan=advisor" },
  { icon: Building2, title: "Emlak ofisi", desc: `${getPlan("office").limits.seats} kullanıcı · ${getPlan("office").limits.branches} şubeye kadar`, href: "/kayit?plan=office" },
  { icon: Briefcase, title: "Büyük ofis, çok şube", desc: `${getPlan("professional").limits.seats} kullanıcıya kadar · ${getPlan("professional").limits.branches} şube`, href: "/kayit?plan=professional" },
  { icon: Landmark, title: "Franchise ve proje satış", desc: `${getPlan("enterprise").limits.seats} kullanıcıya kadar · sınırsız şube`, href: "/kayit?plan=enterprise" },
];

const resources: MenuItem[] = [
  { icon: Workflow, title: "Nasıl çalışır", desc: "Dört adımda akış", href: "/#nasil" },
  { icon: ShieldCheck, title: "Güvenlik ve uyum", desc: "Veri, yetki ve denetim", href: "/#guvenlik" },
  { icon: HelpCircle, title: "Sık sorulan sorular", desc: "Kurulum, veri, iptal", href: "/#sss" },
  { icon: LifeBuoy, title: "Demo görüşmesi", desc: "Ürünü birlikte inceleyelim", href: "/demo" },
];

const menus = [
  { key: "product", label: "Ürün", items: product, cols: "sm:grid-cols-2" },
  { key: "solutions", label: "Çözümler", items: solutions, cols: "sm:grid-cols-2" },
  { key: "resources", label: "Kaynaklar", items: resources, cols: "sm:grid-cols-2" },
] as const;

const linkCls = "rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-ink-800 transition hover:bg-brand-50 hover:text-brand-700";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      frame = null;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!active && !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const key = active;
      setActive(null);
      setOpen(false);
      if (key) requestAnimationFrame(() => document.getElementById(`menu-trigger-${key}`)?.focus());
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setActive(null);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [active, open]);

  const openMenu = (key: string | null) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActive(key);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 140);
  };
  const closeAll = () => {
    setActive(null);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="sticky top-0 z-50">
      <header
        className={`relative border-b bg-white/90 backdrop-blur-xl transition-shadow duration-300 ${
          scrolled || active || open ? "border-line shadow-[var(--shadow-sm)]" : "border-transparent"
        }`}
        onMouseLeave={scheduleClose}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="EmlakSoft ana sayfa">
            <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-[linear-gradient(135deg,var(--brand-600),var(--brand-700))] font-display text-base font-extrabold text-white shadow-[var(--shadow-glow-brand)]">E</span>
            <span className="font-display text-xl font-extrabold tracking-tight text-ink-950">EmlakSoft</span>
          </Link>

          <nav aria-label="Ana site navigasyonu" className="hidden items-center gap-0.5 lg:flex">
            {menus.map((m) => (
              <div key={m.key} className="relative" onMouseEnter={() => openMenu(m.key)}>
                <button
                  id={`menu-trigger-${m.key}`}
                  type="button"
                  aria-expanded={active === m.key}
                  aria-controls={`menu-${m.key}`}
                  onClick={(event) => openMenu(event.detail === 0 && active === m.key ? null : m.key)}
                  className={`${linkCls} flex items-center gap-1 ${active === m.key ? "bg-brand-50 text-brand-700" : ""}`}
                >
                  {m.label}
                  <ChevronDown className={`h-3.5 w-3.5 transition ${active === m.key ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {active === m.key ? (
                  <div id={`menu-${m.key}`} role="region" aria-label={m.label} onMouseEnter={() => openMenu(m.key)} className="dropdown-in absolute left-0 top-full w-[26rem] pt-2">
                    <ul className="grid gap-1 rounded-[var(--radius-panel)] border border-line bg-white p-2 shadow-[var(--shadow-lg)]">
                      {m.items.map((it) => (
                        <li key={it.title}>
                          <Link href={it.href} onClick={closeAll} className="group flex items-start gap-3 rounded-[var(--radius-card)] p-2.5 transition hover:bg-brand-50">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">
                              <it.icon className="h-[18px] w-[18px]" />
                            </span>
                            <span>
                              <span className="block text-sm font-semibold text-ink-950">{it.title}</span>
                              <span className="block text-xs leading-relaxed text-text-muted">{it.desc}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
            <Link href="/#fiyat" onMouseEnter={() => openMenu(null)} className={linkCls}>Fiyatlandırma</Link>
            <Link href="/#sss" onMouseEnter={() => openMenu(null)} className={linkCls}>SSS</Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/giris" className={`${linkCls} hidden sm:inline-block`}>Giriş yap</Link>
            <Link
              href="/kayit"
              className="hidden items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:bg-brand-700 sm:inline-flex"
            >
              14 gün ücretsiz dene <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
              aria-expanded={open}
              aria-controls="mobile-site-navigation"
              className="grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line bg-white text-ink-950 lg:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {open ? (
        <nav id="mobile-site-navigation" aria-label="Mobil site navigasyonu" className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-white shadow-[var(--shadow-lg)] lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {[
              ["Özellikler", "/#ozellikler"],
              ["Kayıp-kaçak motoru", "/#kayip-kacak"],
              ["Nasıl çalışır", "/#nasil"],
              ["Fiyatlandırma", "/#fiyat"],
              ["Güvenlik ve uyum", "/#guvenlik"],
              ["SSS", "/#sss"],
            ].map(([label, href]) => (
              <Link key={label} href={href} onClick={closeAll} className="flex min-h-11 items-center justify-between rounded-[var(--radius-control)] px-3 text-base font-medium text-ink-900 hover:bg-brand-50">
                {label}
                <ChevronDown className="h-4 w-4 -rotate-90 text-text-faint" aria-hidden="true" />
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 pb-2">
              <Link href="/giris" onClick={closeAll} className="flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line-strong px-4 text-sm font-semibold text-ink-950">
                Giriş yap
              </Link>
              <Link href="/kayit" onClick={closeAll} className="flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white">
                Ücretsiz dene
              </Link>
            </div>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
