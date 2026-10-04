"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Brand } from "@/components/brand/brand";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { MARKETING_NAV, type NavFeatured, type NavGroup, type NavLink } from "@/lib/marketing-nav";

/**
 * Üst bar + MEGA MENÜ. İçerik tek yerde: src/lib/marketing-nav.ts (sayfa yolları orada).
 * Erişilebilirlik (APG "disclosure navigation"): düğme aria-expanded/aria-controls; Enter/Boşluk/Aşağı ok açar ve ilk
 * bağlantıya odaklanır; Sol/Sağ ok üst düzey düğmeler arasında gezer; panel içinde Yukarı/Aşağı/Home/End bağlantıları
 * dolaşır; Esc kapatır ve odağı düğmeye geri verir; odak panelden çıkınca kapanır. Fare ile açma kısa gecikmelidir
 * (titreme yok). Mobilde tam ekran panel + akordeon. Hareket yalnız opacity/transform ve reduced-motion'da kapalı.
 */
const isInternal = (href: string) => href.startsWith("/");

function NavAnchor({ link, onClick, className, children }: { link: NavLink; onClick: () => void; className?: string; children: React.ReactNode }) {
  if (isInternal(link.href)) {
    return (
      <Link href={link.href} onClick={onClick} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={link.href} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

function Featured({ f, onClick }: { f: NavFeatured; onClick: () => void }) {
  return (
    <Link href={f.href} onClick={onClick} className="mk-mega-feat">
      <span className="mk-mega-feat-ico"><f.icon size={22} aria-hidden="true" /></span>
      <span className="mk-mega-feat-eyebrow">{f.eyebrow}</span>
      <b>{f.title}</b>
      <small>{f.text}</small>
      <span className="mk-mega-feat-cta">{f.cta}<ArrowRight size={16} aria-hidden="true" /></span>
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const panels = useRef<Record<string, HTMLDivElement | null>>({});
  const focusFirst = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Klavyeyle açılınca ilk bağlantıya odak.
  useEffect(() => {
    if (menu && focusFirst.current === menu) {
      focusFirst.current = null;
      panels.current[menu]?.querySelector<HTMLElement>("a[href]")?.focus();
    }
  }, [menu]);

  useEffect(() => {
    if (!open && !menu) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) {
        const t = triggers.current[menu];
        const inPanel = panels.current[menu]?.contains(document.activeElement);
        setMenu(null);
        if (inPanel) t?.focus();
      }
      if (open) {
        setOpen(false);
        burgerRef.current?.focus();
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
    if (open) sheetRef.current?.querySelector<HTMLElement>("summary")?.focus();
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMenu(null);
  }, []);

  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>, g: NavGroup, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusFirst.current = g.id;
      setMenu(g.id);
      if (menu === g.id) panels.current[g.id]?.querySelector<HTMLElement>("a[href]")?.focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = MARKETING_NAV[(index + (e.key === "ArrowRight" ? 1 : -1) + MARKETING_NAV.length) % MARKETING_NAV.length]!;
      triggers.current[next.id]?.focus();
      if (menu) setMenu(next.id);
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>, g: NavGroup) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const links = [...(panels.current[g.id]?.querySelectorAll<HTMLElement>("a[href]") ?? [])];
    if (links.length === 0) return;
    e.preventDefault();
    const i = links.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : e.key === "ArrowDown" ? (i + 1) % links.length : (i - 1 + links.length) % links.length;
    links[to]!.focus();
  };

  return (
    <div className="mk-nav" data-scrolled={scrolled} data-open={open} data-menu={menu ?? undefined} ref={rootRef}>
      <header>
        <div className="mk-wrap mk-wrap-wide mk-nav-row">
          <Link href="/" className="mk-logo" aria-label="EmlakSoft ana sayfa" onClick={close}>
            <Brand variant="horizontal" tone="light" height={34} alt="" />
          </Link>
          <nav aria-label="Ana site navigasyonu" className="mk-nav-links">
            {MARKETING_NAV.map((g, index) => {
              const isOpen = menu === g.id;
              return (
                <div
                  key={g.id}
                  className="mk-dd"
                  data-open={isOpen}
                  onPointerEnter={(e) => {
                    if (e.pointerType !== "mouse") return;
                    clearHover();
                    hoverTimer.current = setTimeout(() => setMenu(g.id), menu ? 0 : 90);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType !== "mouse") return;
                    clearHover();
                    hoverTimer.current = setTimeout(() => setMenu((m) => (m === g.id ? null : m)), 160);
                  }}
                  onBlur={(e) => {
                    if (isOpen && !e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(null);
                  }}
                >
                  <button
                    type="button"
                    id={`mega-btn-${g.id}`}
                    ref={(el) => {
                      triggers.current[g.id] = el;
                    }}
                    className="mk-nav-link"
                    aria-expanded={isOpen}
                    aria-controls={`mega-${g.id}`}
                    onClick={() => setMenu(isOpen ? null : g.id)}
                    onKeyDown={(e) => onTriggerKey(e, g, index)}
                  >
                    {g.label}
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  <div
                    id={`mega-${g.id}`}
                    role="group"
                    aria-labelledby={`mega-btn-${g.id}`}
                    className="mk-mega"
                    hidden={!isOpen}
                    ref={(el) => {
                      panels.current[g.id] = el;
                    }}
                    onKeyDown={(e) => onPanelKey(e, g)}
                  >
                    <div className="mk-mega-in">
                      <div className="mk-mega-cols" data-cols={g.columns.length}>
                        {g.columns.map((c) => (
                          <div key={c.title} className="mk-mega-col">
                            <p className="mk-mega-title">{c.title}</p>
                            <ul>
                              {c.items.map((it, i) => (
                                <li key={it.label} style={{ "--i": i } as React.CSSProperties}>
                                  <NavAnchor link={it} onClick={close}>
                                    <span className="mk-panel-ico"><it.icon size={18} aria-hidden="true" /></span>
                                    <span><b>{it.label}</b><small>{it.text}</small></span>
                                  </NavAnchor>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      <Featured f={g.featured} onClick={close} />
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="mk-nav-cta">
            <Link href="/giris" className="mk-btn mk-btn-line mk-login">Giriş yap</Link>
            <Link href="/kayit" className="mk-btn mk-btn-primary mk-nav-trial">
              <span className="mk-long">Ücretsiz dene</span><span className="mk-short">Ücretsiz dene</span> <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <button
              type="button"
              ref={burgerRef}
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
        <nav id="mobile-site-navigation" aria-label="Mobil site navigasyonu" className="mk-sheet" ref={sheetRef}>
          <div className="mk-sheet-scroll">
            {MARKETING_NAV.map((g) => (
              <details key={g.id} className="mk-sheet-group">
                <summary>{g.label}<ChevronDown size={18} aria-hidden="true" /></summary>
                {g.columns.map((c) => (
                  <div key={c.title}>
                    <p className="mk-sheet-sub">{c.title}</p>
                    <ul>
                      {c.items.map((it) => (
                        <li key={it.label}>
                          <NavAnchor link={it} onClick={close}>
                            <it.icon size={18} aria-hidden="true" /><span><b>{it.label}</b><small>{it.text}</small></span>
                          </NavAnchor>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <Featured f={g.featured} onClick={close} />
              </details>
            ))}
            {/* Sert gezinme bilerek: kök [...slug] rotası eklenince kural uyarır; davranış değişmez. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/giris" className="mk-sheet-link" onClick={close}>Giriş yap</a>
          </div>
          <div className="mk-sheet-cta">
            <Link href="/kayit" className="mk-btn mk-btn-grad" onClick={close}>Ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link href="/demo" className="mk-btn mk-btn-line" onClick={close}>Demo görüşmesi planla</Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
