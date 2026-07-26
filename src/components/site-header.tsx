"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  Gauge,
  LifeBuoy,
  Menu,
  Newspaper,
  PhoneIncoming,
  Radar,
  Scale,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
  Code2,
  Briefcase,
  Landmark,
  ShieldCheck,
  Zap,
} from "lucide-react";

type FeatureItem = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  href: string;
  tone: string;
};

const featureMenu: FeatureItem[] = [
  { icon: Radar, title: "Kayıp-kaçak motoru", desc: "Kaçan komisyonu rakamla gör", href: "#ozellikler", tone: "text-danger-500 bg-danger-500/10" },
  { icon: PhoneIncoming, title: "Akıllı Arama OS", desc: "Telefon çalınca müşteriyi tanı", href: "#ozellikler", tone: "text-mint-600 bg-mint-500/12" },
  { icon: Wallet, title: "Komisyon defteri", desc: "Hakediş & bölüşüm şeffaf", href: "#ozellikler", tone: "text-brand-600 bg-brand-600/10" },
  { icon: TrendingUp, title: "Fiyat vicdanı", desc: "Bölgeye göre pahalı/ucuz", href: "#ozellikler", tone: "text-brand-600 bg-brand-600/10" },
  { icon: Scale, title: "Mevzuat rayı", desc: "İYS · EİDS · KVKK uyumu", href: "#ozellikler", tone: "text-amber-500 bg-amber-400/15" },
  { icon: Building2, title: "Portföy & portal", desc: "İlan teyit + kapanış formu", href: "#ozellikler", tone: "text-mint-600 bg-mint-500/12" },
];

const solutions = [
  { icon: Users, title: "Bağımsız danışman", desc: "Tek başına, tam donanım", href: "#fiyat" },
  { icon: Building2, title: "Emlak ofisi", desc: "2–50 kişilik ekipler", href: "#fiyat" },
  { icon: Landmark, title: "Franchise", desc: "Çok şube & finans", href: "#fiyat" },
  { icon: Briefcase, title: "Proje satış", desc: "Konut projeleri", href: "#fiyat" },
];

const resources = [
  { icon: Newspaper, title: "Ürün gündemi", desc: "Sektör & ürün", href: "#karsilastirma" },
  { icon: BookOpen, title: "Başlangıç rehberi", desc: "Nasıl yapılır", href: "#nasil" },
  { icon: LifeBuoy, title: "Yardım merkezi", desc: "Destek & SSS", href: "#sss" },
  { icon: Code2, title: "API & entegrasyon", desc: "Teknik iletişim", href: "mailto:destek@emlaksoft.com.tr" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFrame = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      scrollFrame.current = null;
      const next = window.scrollY > 10;
      setScrolled((current) => (current === next ? current : next));
    };
    const onScroll = () => {
      if (scrollFrame.current === null) {
        scrollFrame.current = requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  const openMenu = (key: string | null) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActive(key);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 120);
  };

  return (
    <div className="sticky top-0 z-50">
      {banner ? (
        <div className="relative bg-[image:var(--grad-ink)] text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs sm:text-sm">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-white/90">
              <b className="font-semibold text-white">Yeni:</b> Kayıp-kaçak
              motoru artık canlı — kaçan komisyonu ilk kez rakamla görün
            </span>
            <Link href="/kayit" className="hidden font-semibold text-mint-400 hover:underline sm:inline">
              Dene →
            </Link>
            <button
              onClick={() => setBanner(false)}
              aria-label="Kapat"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <header
        className={`relative z-30 transition-all duration-300 ${
          active
            ? "border-b border-white bg-white/98 shadow-[0_18px_50px_-28px_rgba(7,26,56,0.5)]"
            : scrolled
            ? "glass border-b border-line/70 shadow-[0_6px_24px_rgba(10,34,71,0.07)]"
            : "border-b border-transparent bg-canvas/60 backdrop-blur-sm"
        }`}
        onMouseLeave={scheduleClose}
      >
        <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[image:var(--grad-brand)] text-white shadow-[0_8px_20px_-6px_rgba(20,99,255,0.75)]">
              <span className="font-display text-base font-extrabold">E</span>
            </span>
            <span className="font-display text-lg font-extrabold tracking-tight text-ink-950">
              EmlakSoft
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <MenuTrigger label="Özellikler" menuKey="features" active={active} onOpen={openMenu} />
            <MenuTrigger label="Çözümler" menuKey="solutions" active={active} onOpen={openMenu} />
            <a href="#fiyat" onMouseEnter={() => openMenu(null)} className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-muted transition hover:text-ink-950">
              Fiyatlandırma
            </a>
            <MenuTrigger label="Kaynaklar" menuKey="resources" active={active} onOpen={openMenu} />
            <a href="#sss" onMouseEnter={() => openMenu(null)} className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-muted transition hover:text-ink-950">
              SSS
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/giris" className="hidden rounded-[10px] px-3 py-2 text-sm font-medium text-text-muted transition hover:text-ink-950 sm:inline">
              Giriş yap
            </Link>
            <Link href="/kayit" className="btn-shine hidden items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(20,99,255,0.8)] transition hover:bg-brand-700 sm:inline-flex">
              Ücretsiz dene
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
              aria-expanded={open}
              className="grid h-10 w-10 place-items-center rounded-[10px] border border-line bg-surface text-ink-950 md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {/* mega panels */}
          {active === "features" ? (
            <MegaPanel onEnter={() => openMenu("features")} onLeave={scheduleClose}>
              <div className="mb-4 flex items-center justify-between border-b border-line pb-4">
                <div>
                  <p className="font-display text-sm font-bold text-ink-950">Emlak operasyonunuzun tamamı</p>
                  <p className="mt-0.5 text-xs text-text-muted">Satıştan mevzuata kadar 6 güçlü işletim katmanı</p>
                </div>
                <span className="hidden items-center gap-1.5 rounded-full bg-mint-500/10 px-3 py-1.5 text-[11px] font-bold text-mint-600 sm:flex">
                  <Zap className="h-3.5 w-3.5" /> Tümü tek platformda
                </span>
              </div>
              <div className="grid gap-5 lg:grid-cols-[1.55fr_.85fr]">
                <div className="grid grid-cols-2 gap-1.5">
                  {featureMenu.map((f) => (
                    <a key={f.title} href={f.href} onClick={() => setActive(null)} className="group relative flex items-start gap-3 overflow-hidden rounded-[14px] border border-transparent p-3 transition hover:border-line hover:bg-canvas hover:shadow-[var(--shadow-xs)]">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] transition group-hover:scale-110 ${f.tone}`}>
                        <f.icon className="h-[18px] w-[18px]" />
                      </span>
                      <span>
                        <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                          {f.title}
                          {f.title === "Kayıp-kaçak motoru" ? <em className="rounded-full bg-danger-500/10 px-1.5 py-0.5 text-[10px] font-bold not-italic text-danger-500">YENİ</em> : null}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{f.desc}</span>
                      </span>
                      <ArrowUpRight className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-brand-600 opacity-0 transition group-hover:opacity-100" />
                    </a>
                  ))}
                </div>
                <div className="relative overflow-hidden rounded-[18px] bg-[image:var(--grad-ink)] p-5 text-white shadow-[var(--shadow-lg)]">
                  <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-40" />
                  <div className="relative">
                    <div className="flex items-center justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-white/10"><Gauge className="h-5 w-5 text-mint-400" /></span>
                      <span className="rounded-full bg-mint-400/15 px-2 py-1 text-[11px] font-bold text-mint-400">CANLI</span>
                    </div>
                    <p className="mt-4 font-display text-base font-bold">Ofis Sağlık Skoru</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/65">Teyit, kaçak, dönüşüm ve hakediş tek skorda.</p>
                    <div className="mt-4 flex items-end justify-between">
                      <div><b className="font-display text-4xl text-mint-400">78</b><span className="text-xs text-white/40"> / 100</span></div>
                      <svg viewBox="0 0 100 32" className="h-9 w-24" aria-hidden="true">
                        <path d="M2 28 C18 28 20 21 34 22 S51 13 64 16 S80 6 98 4" fill="none" stroke="#34d3bd" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                  <Link href="/kayit" onClick={() => setActive(null)} className="relative mt-4 inline-flex items-center gap-1 text-sm font-semibold text-mint-400">
                    Keşfet <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </MegaPanel>
          ) : null}

          {active === "solutions" ? (
            <MegaPanel onEnter={() => openMenu("solutions")} onLeave={scheduleClose}>
              <div className="mb-4">
                <p className="font-display text-sm font-bold text-ink-950">Ekibinize göre ölçeklenen çözümler</p>
                <p className="mt-0.5 text-xs text-text-muted">Tek danışmandan çok şubeli organizasyona</p>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {solutions.map((s) => (
                  <a key={s.title} href={s.href} onClick={() => setActive(null)} className="group relative overflow-hidden rounded-[15px] border border-line bg-canvas/60 p-4 transition hover:-translate-y-1 hover:border-brand-300 hover:bg-surface hover:shadow-[var(--shadow-card)]">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                      <s.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="mt-4 block text-sm font-semibold text-ink-950">{s.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.desc}</span>
                    <ArrowRight className="mt-4 h-4 w-4 text-brand-600 transition group-hover:translate-x-1" />
                  </a>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-[13px] bg-[image:var(--grad-brand-soft)] px-4 py-3">
                <span className="flex items-center gap-2 text-xs font-semibold text-ink-900"><ShieldCheck className="h-4 w-4 text-mint-600" /> Her pakette KVKK, İYS ve EİDS uyum katmanı</span>
                <Link href="#fiyat" className="hidden text-xs font-bold text-brand-600 sm:block">Paketleri karşılaştır →</Link>
              </div>
            </MegaPanel>
          ) : null}

          {active === "resources" ? (
            <MegaPanel onEnter={() => openMenu("resources")} onLeave={scheduleClose}>
              <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
                <div>
                  <p className="mb-3 font-display text-sm font-bold text-ink-950">Bilgi merkezi</p>
                  <div className="grid grid-cols-2 gap-1">
                  {resources.map((s) => (
                    <a key={s.title} href={s.href} onClick={() => setActive(null)} className="group flex items-start gap-3 rounded-[12px] p-3 transition hover:bg-canvas">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-ink-950/5 text-ink-800">
                      <s.icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">{s.title}</span>
                      <span className="block text-xs text-text-muted">{s.desc}</span>
                    </span>
                    </a>
                  ))}
                  </div>
                </div>
                <div className="relative overflow-hidden rounded-[16px] border border-line bg-canvas p-4">
                  <BarChart3 className="h-5 w-5 text-brand-600" />
                  <p className="mt-3 font-display text-sm font-bold text-ink-950">2026 Emlak Operasyon Raporu</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">Portföy dönüşümü, kaçak oranı ve komisyon benchmark’ları.</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-600">Ücretsiz indir <ArrowRight className="h-3.5 w-3.5" /></span>
                  <div className="absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-brand-600/10 blur-xl" />
                </div>
              </div>
            </MegaPanel>
          ) : null}
        </div>
      </header>

      {active ? (
        <button
          type="button"
          aria-label="Mega menüyü kapat"
          onClick={() => setActive(null)}
          className="mega-backdrop fixed inset-0 z-20 cursor-default"
        />
      ) : null}

      {open ? (
        <div className="glass border-b border-line/70 md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {[
              ["Özellikler", "#ozellikler"],
              ["Çözümler", "#fiyat"],
              ["Fiyatlandırma", "#fiyat"],
              ["Kaynaklar", "#sss"],
              ["SSS", "#sss"],
            ].map(([label, href]) => (
              <a key={label} href={href} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-[10px] px-3 py-2.5 text-sm font-medium text-text hover:bg-canvas">
                {label}
                <ChevronDown className="h-4 w-4 -rotate-90 text-text-faint" />
              </a>
            ))}
            <div className="mt-2 flex gap-2">
              <Link href="/giris" className="flex-1 rounded-[10px] border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink-950">
                Giriş yap
              </Link>
              <Link href="/kayit" className="flex-1 rounded-[10px] bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white">
                Ücretsiz dene
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuTrigger({
  label,
  menuKey,
  active,
  onOpen,
}: {
  label: string;
  menuKey: string;
  active: string | null;
  onOpen: (k: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onOpen(menuKey)}
      onClick={() => onOpen(menuKey)}
      aria-expanded={active === menuKey}
      className={`flex items-center gap-1 rounded-[10px] px-3 py-2 text-sm font-medium transition ${
        active === menuKey ? "text-brand-600" : "text-text-muted hover:text-ink-950"
      }`}
    >
      {label}
      <ChevronDown className={`h-3.5 w-3.5 transition ${active === menuKey ? "rotate-180" : ""}`} />
    </button>
  );
}

function MegaPanel({
  children,
  onEnter,
  onLeave,
}: {
  children: React.ReactNode;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="dropdown-in absolute left-1/2 top-full z-50 w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 pt-3"
    >
      <div className="mega-surface rounded-[22px] border border-line bg-surface/95 p-5 shadow-[var(--shadow-lg)] backdrop-blur-xl">
        {children}
      </div>
    </div>
  );
}
