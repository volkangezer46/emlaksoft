"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ExternalLink, Menu, X } from "lucide-react";
import { FeaturedMedia } from "./featured-media";
import type { PublicFeatured, PublicGroup, PublicItem } from "@/lib/site-menu/public";

/**
 * Herkese açık üst bar + MEGA MENÜ (istemci). İçerik admin'den (/admin/site-menu) gelir; varsayılan içerik
 * src/lib/site-menu/defaults.ts. Veri sunucudan hazır gelir (ikonlar sunucuda çizilir, istemci paketine ikon listesi girmez).
 * Erişilebilirlik (APG "disclosure navigation"): düğme aria-expanded/aria-controls; Enter/Boşluk/Aşağı ok açar ve ilk
 * bağlantıya odaklanır; Sol/Sağ ok üst düzey düğmeler arasında gezer; panel içinde Yukarı/Aşağı/Home/End bağlantıları
 * dolaşır; Esc kapatır ve odağı düğmeye geri verir; odak panelden çıkınca kapanır. Fare ile açma kısa gecikmelidir
 * (titreme yok). Kapalı panel `inert` + görünmez (yumuşak kapanış). Mobilde tam ekran panel + akordeon.
 * Hareket yalnız opacity/transform; reduced-motion'da kapalı.
 */

export type ClientItem = Omit<PublicItem, "icon"> & { iconNode: ReactNode };
export type ClientFeatured = Omit<PublicFeatured, "icon"> & { iconNode: ReactNode };
export type ClientGroup = Omit<PublicGroup, "columns" | "featured"> & {
  columns: Array<{ title: string; items: ClientItem[] }>;
  featured: ClientFeatured | null;
};

const extProps = (external: boolean) => (external ? { target: "_blank", rel: "noopener noreferrer" } : {});
const isInternal = (href: string) => href.startsWith("/");

function ItemLabel({ it }: { it: Pick<ClientItem, "label" | "badge" | "external"> }) {
  return (
    <b>
      {it.label}
      {it.badge ? <em className="mk-badge" data-kind={it.badge}>{it.badge === "yeni" ? "Yeni" : "Popüler"}</em> : null}
      {it.external ? (
        <>
          <ExternalLink size={12} aria-hidden="true" className="mk-ext" />
          <span className="sr-only"> (yeni sekmede açılır)</span>
        </>
      ) : null}
    </b>
  );
}

function spot(e: ReactPointerEvent<HTMLAnchorElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

function NavAnchor({ href, external, onClick, className, onPointerMove, style, children }: { href: string; external: boolean; onClick: () => void; className?: string; onPointerMove?: (e: ReactPointerEvent<HTMLAnchorElement>) => void; style?: CSSProperties; children: ReactNode }) {
  if (!external && isInternal(href)) {
    return (
      <Link href={href} onClick={onClick} className={className} onPointerMove={onPointerMove} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} onClick={onClick} className={className} onPointerMove={onPointerMove} style={style} {...extProps(external)}>
      {children}
    </a>
  );
}

function Featured({ f, onClick, active, index, withMedia }: { f: ClientFeatured; onClick: () => void; active: boolean; index: number; withMedia: boolean }) {
  return (
    <NavAnchor href={f.href} external={f.external} onClick={onClick} className="mk-mega-feat" style={{ "--i": index } as CSSProperties}>
      <>
        {withMedia && f.media ? <FeaturedMedia media={f.media} active={active} /> : null}
        {f.iconNode ? <span className="mk-mega-feat-ico">{f.iconNode}</span> : null}
        {f.eyebrow ? <span className="mk-mega-feat-eyebrow">{f.eyebrow}</span> : null}
        <b>{f.title}</b>
        {f.text ? <small>{f.text}</small> : null}
        <span className="mk-mega-feat-cta">
          {f.ctaLabel}
          <ArrowRight size={16} aria-hidden="true" />
          {f.external ? <span className="sr-only"> (yeni sekmede açılır)</span> : null}
        </span>
      </>
    </NavAnchor>
  );
}

export function SiteHeaderClient({ groups, logo, top }: { groups: ClientGroup[]; logo: ReactNode; top?: ReactNode }) {
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
  const menuGroups = groups.filter((g) => g.kind === "menu");

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

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>, g: ClientGroup, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusFirst.current = g.id;
      setMenu(g.id);
      if (menu === g.id) panels.current[g.id]?.querySelector<HTMLElement>("a[href]")?.focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = menuGroups[(index + (e.key === "ArrowRight" ? 1 : -1) + menuGroups.length) % menuGroups.length]!;
      triggers.current[next.id]?.focus();
      if (menu) setMenu(next.id);
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>, g: ClientGroup) => {
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
    <div className="mk-nav" data-scrolled={scrolled} data-open={open} data-menu={menu ?? undefined} data-ann={Boolean(top)} ref={rootRef}>
      {top}
      <header>
        <div className="mk-wrap mk-wrap-wide mk-nav-row">
          <Link href="/" className="mk-logo" aria-label="EmlakSoft ana sayfa" onClick={close}>
            {logo}
          </Link>
          <nav aria-label="Ana site navigasyonu" className="mk-nav-links">
            {groups.map((g) => {
              if (g.kind === "link") {
                return (
                  <div key={g.id} className="mk-nav-item">
                    <NavAnchor href={g.href} external={g.external} onClick={close} className="mk-nav-link">
                      {g.label}
                      {g.external ? <span className="sr-only"> (yeni sekmede açılır)</span> : null}
                    </NavAnchor>
                  </div>
                );
              }
              const index = menuGroups.indexOf(g);
              const isOpen = menu === g.id;
              const offsets = g.columns.map((_, ci) => g.columns.slice(0, ci).reduce((a, x) => a + x.items.length, 0));
              const total = g.columns.reduce((a, x) => a + x.items.length, 0);
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
                    inert={!isOpen}
                    ref={(el) => {
                      panels.current[g.id] = el;
                    }}
                    onKeyDown={(e) => onPanelKey(e, g)}
                  >
                    <div className="mk-mega-in" data-feat={g.featured ? "true" : "false"}>
                      <div className="mk-mega-cols" data-cols={Math.min(Math.max(g.columns.length, 1), 3)}>
                        {g.columns.map((c, ci) => (
                          <div key={c.title || "_"} className="mk-mega-col">
                            {c.title ? <p className="mk-mega-title">{c.title}</p> : null}
                            <ul>
                              {c.items.map((it, ii) => (
                                <li key={it.id} style={{ "--i": offsets[ci]! + ii } as CSSProperties}>
                                  <NavAnchor href={it.href} external={it.external} onClick={close} onPointerMove={spot}>
                                    <span className="mk-panel-ico">{it.iconNode}</span>
                                    <span><ItemLabel it={it} /><small>{it.text}</small></span>
                                  </NavAnchor>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      {g.featured ? <Featured f={g.featured} onClick={close} active={isOpen} index={total} withMedia /> : null}
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
          <MobileSheetBody groups={groups} close={close} />
          <div className="mk-sheet-cta">
            <Link href="/kayit" className="mk-btn mk-btn-grad" onClick={close}>Ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link href="/demo" className="mk-btn mk-btn-line" onClick={close}>Demo görüşmesi planla</Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

/** Mobil gövde: grup başına akordeon (<details>); doğrudan bağlantı grupları aynı sırada. Admin önizlemesi bunu yeniden kullanır. */
export function MobileSheetBody({ groups, close }: { groups: ClientGroup[]; close: () => void }) {
  return (
    <div className="mk-sheet-scroll">
      {groups.map((g) =>
        g.kind === "link" ? (
          <NavAnchor key={g.id} href={g.href} external={g.external} onClick={close} className="mk-sheet-link">{g.label}</NavAnchor>
        ) : (
          <details key={g.id} className="mk-sheet-group">
            <summary>{g.label}<ChevronDown size={18} aria-hidden="true" /></summary>
            {g.columns.map((c) => (
              <div key={c.title || "_"}>
                {c.title ? <p className="mk-sheet-sub">{c.title}</p> : null}
                <ul>
                  {c.items.map((it) => (
                    <li key={it.id}>
                      <NavAnchor href={it.href} external={it.external} onClick={close}>
                        {it.iconNode}<span><ItemLabel it={it} /><small>{it.text}</small></span>
                      </NavAnchor>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {g.featured ? <Featured f={g.featured} onClick={close} active={false} index={0} withMedia={false} /> : null}
          </details>
        ),
      )}
      {/* Sert gezinme bilerek: kök [...slug] rotası eklenince kural uyarır; davranış değişmez. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/giris" className="mk-sheet-link" onClick={close}>Giriş yap</a>
    </div>
  );
}
