"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand/brand";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Building2,
  ChevronDown,
  CircleHelp,
  FileSignature,
  Globe,
  LayoutDashboard,
  Link2,
  Lock,
  Mail,
  Menu,
  Scale,
  ShieldAlert,
  Briefcase,
  UserRound,
  Crown,
  Workflow,
  X,
  CalendarCheck,
  Route,
  Calculator,
  type LucideIcon,
} from "lucide-react";

type Item = { label: string; text: string; href: string; icon: LucideIcon };
type Group = { id: string; label: string; wide?: boolean; items: Item[] };

/** Yalnız var olan rotalar ve ana sayfa bölüm bağlantıları (ölü bağlantı yok; Blog sayfası olmadığı için menüde yoktur). */
const GROUPS: Group[] = [
  {
    id: "urun",
    label: "Ürün",
    wide: true,
    items: [
      { label: "Ürün turu", text: "Bugün, müşteriler, portföy ve daha fazlası", href: "/#tur", icon: LayoutDashboard },
      { label: "Kayıp-kaçak kalkanı", text: "Kaçan komisyonu rakama dökün", href: "/#kayip-kacak", icon: ShieldAlert },
      { label: "Emsal bazlı değerleme", text: "Fiyat aralığı sinyali", href: "/#degerleme", icon: Calculator },
      { label: "Otomasyonlar", text: "27 otomatik görev", href: "/#otomasyon", icon: Workflow },
      { label: "Portal kontrolü", text: "İlan takibi ve teyit", href: "/#portal-kontrol", icon: Link2 },
      { label: "Dijital imza", text: "SMS onaylı sözleşme akışı", href: "/#imza", icon: FileSignature },
      { label: "AI asistan", text: "Kişisel veri maskeli", href: "/#ai-asistan", icon: Bot },
      { label: "Vitrin ve portallar", text: "Ofis vitrini, token’lı portallar", href: "/#vitrin", icon: Globe },
    ],
  },
  {
    id: "cozum",
    label: "Çözümler",
    items: [
      { label: "Bağımsız danışman", text: "Danışman paketi", href: "/kayit?plan=advisor", icon: UserRound },
      { label: "Emlak ofisi", text: "Ofis paketi", href: "/kayit?plan=office", icon: Building2 },
      { label: "Büyüyen ekip", text: "Profesyonel paketi", href: "/kayit?plan=professional", icon: Briefcase },
      { label: "Çok şubeli yapı", text: "Kurumsal paketi", href: "/kayit?plan=enterprise", icon: Crown },
      { label: "Paketleri karşılaştır", text: "Fiyat ve limitler", href: "/fiyatlar", icon: BadgeCheck },
    ],
  },
  {
    id: "kaynak",
    label: "Kaynaklar",
    items: [
      { label: "Nasıl çalışır", text: "Üç adımda başlangıç", href: "/#nasil", icon: Route },
      { label: "Sık sorulan sorular", text: "Net cevaplar", href: "/#sss", icon: CircleHelp },
      { label: "Güvenlik ve KVKK", text: "Süreç ve altyapı", href: "/#guvenlik", icon: Lock },
      { label: "KVKK aydınlatma metni", text: "Yasal metin", href: "/kvkk-aydinlatma", icon: Scale },
      { label: "Demo görüşmesi planla", text: "Ürünü birlikte gezelim", href: "/demo", icon: CalendarCheck },
      { label: "Destek", text: "destek@emlaksoft.com.tr", href: "mailto:destek@emlaksoft.com.tr", icon: Mail },
    ],
  },
];

/** Üst bar: beyaz buzlu cam; açılır menüler (tıklama/klavye/fare), mobilde tam ekran menü. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open && !menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMenu(null);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (menu && rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, menu]);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setMenu(null);
  };

  return (
    <div className="mk-nav" data-scrolled={scrolled} data-open={open} ref={rootRef}>
      <header>
        <div className="mk-wrap mk-wrap-wide mk-nav-row">
          <Link href="/" className="mk-logo" aria-label="EmlakSoft ana sayfa" onClick={close}>
            <Brand variant="horizontal" tone="light" height={34} alt="" />
          </Link>
          <nav aria-label="Ana site navigasyonu" className="mk-nav-links">
            {GROUPS.map((g) => (
              <div key={g.id} className="mk-nav-item">
                <Dropdown g={g} menu={menu} setMenu={setMenu} close={close} />
                {g.id === "cozum" ? <Link href="/fiyatlar" className="mk-nav-link" onClick={close}>Fiyatlandırma</Link> : null}
              </div>
            ))}
          </nav>
          <div className="mk-nav-cta">
            <Link href="/giris" className="mk-btn mk-btn-line mk-login">Giriş yap</Link>
            <Link href="/kayit" className="mk-btn mk-btn-primary mk-nav-trial">
              <span className="mk-long">14 gün ücretsiz dene</span><span className="mk-short">Ücretsiz dene</span> <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="mk-burger"
              aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
              aria-expanded={open}
              aria-controls="mobile-site-navigation"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>
      {open ? (
        <nav id="mobile-site-navigation" aria-label="Mobil site navigasyonu" className="mk-sheet">
          <div className="mk-sheet-scroll">
            {GROUPS.map((g) => (
              <details key={g.id} className="mk-sheet-group">
                <summary>{g.label}<ChevronDown size={18} aria-hidden="true" /></summary>
                <ul>
                  {g.items.map((it) => (
                    <li key={it.label}>
                      <a href={it.href} onClick={close}><it.icon size={18} aria-hidden="true" /><span><b>{it.label}</b><small>{it.text}</small></span></a>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <Link href="/fiyatlar" className="mk-sheet-link" onClick={close}>Fiyatlandırma</Link>
            {/* Sert gezinme bilerek: kök [...slug] rotası eklenince kural uyarır; davranış değişmez. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/giris" className="mk-sheet-link" onClick={close}>Giriş yap</a>
          </div>
          <div className="mk-sheet-cta">
            <Link href="/kayit" className="mk-btn mk-btn-grad" onClick={close}>14 gün ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link href="/demo" className="mk-btn mk-btn-line" onClick={close}>Demo görüşmesi planla</Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function Dropdown({ g, menu, setMenu, close }: { g: Group; menu: string | null; setMenu: (v: string | null) => void; close: () => void }) {
  const isOpen = menu === g.id;
  return (
    <div
      className="mk-dd"
      data-open={isOpen}
      onPointerEnter={(e) => e.pointerType === "mouse" && setMenu(g.id)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setMenu(null)}
    >
      <button type="button" className="mk-nav-link" aria-expanded={isOpen} aria-controls={`dd-${g.id}`} onClick={() => setMenu(isOpen ? null : g.id)}>
        {g.label}<ChevronDown size={15} aria-hidden="true" />
      </button>
      <div id={`dd-${g.id}`} className={`mk-panel${g.wide ? " mk-panel-wide" : ""}`} hidden={!isOpen}>
        <ul>
          {g.items.map((it) => (
            <li key={it.label}>
              <a href={it.href} onClick={close}>
                <span className="mk-panel-ico"><it.icon size={18} aria-hidden="true" /></span>
                <span><b>{it.label}</b><small>{it.text}</small></span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
