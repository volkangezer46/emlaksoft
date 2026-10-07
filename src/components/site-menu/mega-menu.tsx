"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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
 * Hareket yalnız opacity/transform; reduced-motion'da kapalı. Fare konumu İZLENMEZ (imleç takibi yok): ikon ve kart
 * hareketi yalnız durum tabanlıdır (hover/focus-visible/açık panel). Mobil sheet modal diyalogtur: arka plan inert, odak tuzağı
 * (Tab/Shift+Tab sheet + kapat düğmesi içinde döner), Esc kapatır. Panel alt çubuğu güven notları + iki hızlı eylem sunar (Tab ile erişilir).
 *
 * CANLI ÖNİZLEME: öne çıkan kartta sunucuda çizilmiş önizleme katmanları (`previews`, ilki varsayılan) üst üste durur; fare
 * üzerine gelince veya klavye odağı bir bağlantıya gelince (`data-pv`) o bağlantının katmanı görünür olur (CSS çapraz geçiş,
 * sahne animasyonu yalnız etkin katmanda bir kez). İstemci yalnız hangi katmanın açık olduğunu seçer; sahne kodu istemci
 * paketine girmez (client-groups.tsx). Panelden çıkınca varsayılan katmana döner; reduced-motion'da geçiş anlıktır.
 */

export type ClientItem = Omit<PublicItem, "icon"> & { iconNode: ReactNode; /** Canlı önizleme türü (client-groups). */ pv?: string | null };
export type ClientFeatured = Omit<PublicFeatured, "icon"> & { iconNode: ReactNode };
/** Sunucuda çizilmiş önizleme katmanı; dizideki ilk öğe varsayılandır. */
export type ClientPreview = { kind: string; node: ReactNode };
export type ClientGroup = Omit<PublicGroup, "columns" | "featured"> & {
  columns: Array<{ title: string; iconNode?: ReactNode; items: ClientItem[] }>;
  featured: ClientFeatured | null;
  previews?: ClientPreview[];
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

function NavAnchor({ href, external, onClick, className, style, children }: { href: string; external: boolean; onClick: () => void; className?: string; style?: CSSProperties; children: ReactNode }) {
  if (!external && isInternal(href)) {
    return (
      <Link href={href} onClick={onClick} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} onClick={onClick} className={className} style={style} {...extProps(external)}>
      {children}
    </a>
  );
}

function Featured({ f, onClick, active, index, withMedia, previews, pv }: { f: ClientFeatured; onClick: () => void; active: boolean; index: number; withMedia: boolean; previews?: ClientPreview[]; pv?: string | null }) {
  const on = previews?.some((p) => p.kind === pv) ? pv : previews?.[0]?.kind;
  return (
    <NavAnchor href={f.href} external={f.external} onClick={onClick} className="mk-mega-feat" style={{ "--i": index } as CSSProperties}>
      <>
        {withMedia && f.media ? (
          <FeaturedMedia media={f.media} active={active} />
        ) : withMedia && previews?.length ? (
          <span className="mk-prev-stack" aria-hidden="true">
            {previews.map((p) => (
              <span key={p.kind} className="mk-prev-layer" data-on={p.kind === on}>
                {p.node}
              </span>
            ))}
          </span>
        ) : null}
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
  // Canlı önizleme: üzerine gelinen / odaklanılan bağlantının önizleme türü (grup kimliğiyle; başka panelde geçersiz).
  const [pv, setPv] = useState<{ g: string; k: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
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

  // Mobil sheet modal: arka plan (sayfa gövdesi, alt bilgi) inert; odak sheet + kapat düğmesi içinde döner.
  useEffect(() => {
    if (!open) return;
    const nav = rootRef.current;
    const changed: HTMLElement[] = [];
    for (const el of Array.from(nav?.parentElement?.children ?? [])) {
      if (el === nav || el.tagName === "SCRIPT" || !(el instanceof HTMLElement) || el.inert) continue;
      el.inert = true;
      changed.push(el);
    }
    const onTab = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = [burgerRef.current, ...(sheetRef.current?.querySelectorAll<HTMLElement>("summary, a[href], button:not([disabled])") ?? [])].filter((x): x is HTMLElement => Boolean(x) && (x as HTMLElement).offsetParent !== null);
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !list.includes(active as HTMLElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !list.includes(active as HTMLElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);
    return () => {
      window.removeEventListener("keydown", onTab);
      for (const el of changed) el.inert = false;
    };
  }, [open]);

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

  // Fare ve klavye odağı aynı yoldan: en yakın [data-pv] öğesi kartın etkin katmanını seçer (imleç konumu izlenmez).
  const pickPreview = (target: EventTarget, g: ClientGroup) => {
    const k = (target as Element).closest?.<HTMLElement>("[data-pv]")?.dataset.pv;
    if (k) setPv((cur) => (cur?.g === g.id && cur.k === k ? cur : { g: g.id, k }));
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
              const cols = Math.min(Math.max(g.columns.length, 1), 3);
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
                    <div
                      className="mk-mega-in"
                      data-feat={g.featured ? "true" : "false"}
                      data-cols={cols}
                      onPointerOver={(e) => pickPreview(e.target, g)}
                      onFocus={(e) => pickPreview(e.target, g)}
                      onPointerLeave={() => setPv(null)}
                    >
                      <div className="mk-mega-cols" data-cols={cols}>
                        {g.columns.map((c, ci) => (
                          <div key={c.title || "_"} className="mk-mega-col">
                            {c.title ? (
                              <p className="mk-mega-title">
                                {c.iconNode ? <span className="mk-mega-title-ico" aria-hidden="true">{c.iconNode}</span> : null}
                                {c.title}
                              </p>
                            ) : null}
                            <ul>
                              {c.items.map((it, ii) => (
                                <li key={it.id} data-pv={it.pv ?? undefined} style={{ "--i": offsets[ci]! + ii } as CSSProperties}>
                                  <NavAnchor href={it.href} external={it.external} onClick={close}>
                                    <span className="mk-panel-ico">{it.iconNode}</span>
                                    <span><ItemLabel it={it} /><small>{it.text}</small></span>
                                  </NavAnchor>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      {g.featured ? <Featured f={g.featured} onClick={close} active={isOpen} index={total} withMedia previews={g.previews} pv={isOpen && pv?.g === g.id ? pv.k : null} /> : null}
                      <div className="mk-mega-bar">
                        <ul className="mk-mega-trust" aria-label="Deneme koşulları">
                          <li>Kartsız deneme</li>
                          <li>Taahhütsüz</li>
                          <li>KVKK süreç araçları</li>
                        </ul>
                        <span className="mk-mega-bar-cta">
                          <Link href="/kayit" className="mk-btn mk-btn-grad" onClick={close}>Ücretsiz dene <ArrowRight size={16} aria-hidden="true" /></Link>
                          <Link href="/fiyatlar" className="mk-btn mk-btn-line" onClick={close}>Fiyatlar</Link>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="mk-nav-cta">
            <Link href="/giris" className="mk-btn mk-btn-line mk-login">Giriş yap</Link>
            <Link href="/giris" className="mk-login-m">Giriş</Link>
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
        <div id="mobile-site-navigation" role="dialog" aria-modal="true" aria-label="Site menüsü" className="mk-sheet" ref={sheetRef}>
          <nav aria-label="Mobil site navigasyonu" className="mk-sheet-nav">
            <MobileSheetBody groups={groups} close={close} />
            <div className="mk-sheet-cta">
              <Link href="/kayit" className="mk-btn mk-btn-grad" onClick={close}>Ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link href="/fiyatlar" className="mk-btn mk-btn-line" onClick={close}>Paketleri ve fiyatları gör</Link>
            </div>
          </nav>
        </div>
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
