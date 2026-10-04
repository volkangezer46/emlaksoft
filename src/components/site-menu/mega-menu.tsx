"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ExternalLink, Menu, X } from "lucide-react";
import { FeaturedMedia } from "./featured-media";
import type { PublicFeatured, PublicGroup, PublicItem } from "@/lib/site-menu/public";

/**
 * Herkese açık üst menü (istemci): masaüstü mega menü + mobil akordeon. Veri sunucudan hazır gelir
 * (ikonlar sunucuda çizilir, istemci paketine ikon listesi girmez). Klavye: Enter/Boşluk açar, Aşağı/Yukarı/Home/End
 * dolaşır, Esc kapatıp odağı düğmeye döndürür, odak panelden çıkınca kapanır. Mobilde <details> akordeonu.
 */

export type ClientItem = Omit<PublicItem, "icon"> & { iconNode: ReactNode };
export type ClientGroup = Omit<PublicGroup, "items"> & { items: ClientItem[] };

const extProps = (external: boolean) => (external ? { target: "_blank", rel: "noopener noreferrer" } : {});

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

export function SiteHeaderClient({ groups, logo, top }: { groups: ClientGroup[]; logo: ReactNode; top?: ReactNode }) {
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

  const hasAnn = Boolean(top);

  return (
    <div className="mk-nav" data-scrolled={scrolled} data-open={open} data-ann={hasAnn} ref={rootRef}>
      {top}
      <header>
        <div className="mk-wrap mk-wrap-wide mk-nav-row">
          <Link href="/" className="mk-logo" aria-label="EmlakSoft ana sayfa" onClick={close}>
            {logo}
          </Link>
          <nav aria-label="Ana site navigasyonu" className="mk-nav-links">
            {groups.map((g) => (
              <div key={g.id} className="mk-nav-item">
                {g.kind === "link" ? (
                  <NavLink g={g} close={close} />
                ) : (
                  <Dropdown g={g} menu={menu} setMenu={setMenu} close={close} />
                )}
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
          <MobileSheetBody groups={groups} close={close} />
          <div className="mk-sheet-cta">
            <Link href="/kayit" className="mk-btn mk-btn-grad" onClick={close}>14 gün ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link href="/demo" className="mk-btn mk-btn-line" onClick={close}>Demo görüşmesi planla</Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function NavLink({ g, close }: { g: ClientGroup; close: () => void }) {
  if (g.external) {
    return (
      <a href={g.href} className="mk-nav-link" onClick={close} {...extProps(true)}>
        {g.label}
        <span className="sr-only"> (yeni sekmede açılır)</span>
      </a>
    );
  }
  return <Link href={g.href} className="mk-nav-link" onClick={close}>{g.label}</Link>;
}

/** Mobil gövde: grup başına akordeon; doğrudan bağlantı grupları da aynı sırada. Admin önizlemesi bunu yeniden kullanır. */
export function MobileSheetBody({ groups, close }: { groups: ClientGroup[]; close: () => void }) {
  return (
    <div className="mk-sheet-scroll">
      {groups.map((g) =>
        g.kind === "link" ? (
          g.external ? (
            <a key={g.id} href={g.href} className="mk-sheet-link" onClick={close} {...extProps(true)}>{g.label}</a>
          ) : (
            <Link key={g.id} href={g.href} className="mk-sheet-link" onClick={close}>{g.label}</Link>
          )
        ) : (
          <details key={g.id} className="mk-sheet-group">
            <summary>{g.label}<ChevronDown size={18} aria-hidden="true" /></summary>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <a href={it.href} onClick={close} {...extProps(it.external)}>
                    {it.iconNode}
                    <span><ItemLabel it={it} /><small>{it.text}</small></span>
                  </a>
                </li>
              ))}
              {g.featured ? (
                <li>
                  <a href={g.featured.href} onClick={close} {...extProps(g.featured.external)}>
                    <ArrowRight size={18} aria-hidden="true" />
                    <span><b>{g.featured.title}</b><small>{g.featured.ctaLabel}</small></span>
                  </a>
                </li>
              ) : null}
            </ul>
          </details>
        ),
      )}
      {/* Sert gezinme bilerek: kök [...slug] rotası eklenince kural uyarır; davranış değişmez. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/giris" className="mk-sheet-link" onClick={close}>Giriş yap</a>
    </div>
  );
}

function Dropdown({ g, menu, setMenu, close }: { g: ClientGroup; menu: string | null; setMenu: (v: string | null) => void; close: () => void }) {
  const isOpen = menu === g.id;
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusFirst = useRef(false);

  useEffect(() => {
    if (isOpen && focusFirst.current) {
      focusFirst.current = false;
      wrapRef.current?.querySelector<HTMLAnchorElement>(".mk-panel a[href]")?.focus();
    }
  }, [isOpen]);

  const links = () => Array.from(wrapRef.current?.querySelectorAll<HTMLAnchorElement>(".mk-panel a[href]") ?? []);

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusFirst.current = true;
      if (isOpen) {
        links()[0]?.focus();
        focusFirst.current = false;
      } else setMenu(g.id);
    }
  };

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = links();
    const i = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (!list.length) return;
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setMenu(null);
      triggerRef.current?.focus();
    }
  };

  const f = g.featured;
  return (
    <div
      ref={wrapRef}
      className="mk-dd"
      data-open={isOpen}
      data-mega={g.wide}
      onPointerEnter={(e) => e.pointerType === "mouse" && setMenu(g.id)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setMenu(null)}
      onBlur={(e) => {
        if (isOpen && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setMenu(null);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="mk-nav-link"
        aria-expanded={isOpen}
        aria-controls={`dd-${g.id}`}
        onClick={() => setMenu(isOpen ? null : g.id)}
        onKeyDown={onTriggerKey}
      >
        {g.label}<ChevronDown size={15} aria-hidden="true" />
      </button>
      <div id={`dd-${g.id}`} className="mk-panel" data-featured={f ? "true" : "false"} inert={!isOpen} onKeyDown={onPanelKey}>
        <div className="mk-panel-card" data-featured={f ? "true" : "false"}>
          <ul className="mk-panel-list" data-cols={g.columns}>
            {g.items.map((it, n) => (
              <li key={it.id} style={{ "--i": n } as React.CSSProperties}>
                <a href={it.href} onClick={close} onPointerMove={spot} {...extProps(it.external)}>
                  <span className="mk-panel-ico">{it.iconNode}</span>
                  <span><ItemLabel it={it} /><small>{it.text}</small></span>
                </a>
              </li>
            ))}
          </ul>
          {f ? <FeaturedCard f={f} active={isOpen} index={g.items.length} close={close} /> : null}
        </div>
      </div>
    </div>
  );
}

function FeaturedCard({ f, active, index, close }: { f: PublicFeatured; active: boolean; index: number; close: () => void }) {
  return (
    <a href={f.href} className="mk-feat" onClick={close} style={{ "--i": index } as React.CSSProperties} {...extProps(f.external)}>
      {f.media ? <FeaturedMedia media={f.media} active={active} /> : null}
      <span className="mk-feat-body">
        <b>{f.title}</b>
        {f.text ? <small>{f.text}</small> : null}
        <span className="mk-feat-cta">
          {f.ctaLabel}
          <ArrowRight size={15} aria-hidden="true" />
          {f.external ? <span className="sr-only"> (yeni sekmede açılır)</span> : null}
        </span>
      </span>
    </a>
  );
}
