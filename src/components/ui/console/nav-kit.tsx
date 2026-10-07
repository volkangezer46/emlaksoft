"use client";

import Link from "@/components/ui/smart-link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SIDEBAR_EVENT, useSidebarCollapsed } from "@/components/ui/console/sidebar-collapse";
import type { LucideIcon } from "lucide-react";

/**
 * Yan menü ortak parçaları (/app ve /admin AYNI menü dili):
 *  - NavScroller: kaydırma gölgesi (üst/alt solma), aktif öğeye akıcı kayan vurgu çubuğu,
 *    ok/Home/End ile klavye gezinmesi. DOM'u doğrudan günceller (render yok), reduced-motion CSS'te.
 *  - NavFlyout: ikon modunda (64px) hover/odakta sağda açılan alt menü + erişilebilir tooltip.
 * Stiller: src/app/console.css (.nav-scroll, .nav-bar, .nav-flyout).
 */

const LINK_SELECTOR = "[data-nav-link]";

function visible(el: HTMLElement) {
  return el.offsetParent !== null;
}

export function NavScroller({
  label,
  className = "",
  innerClassName = "",
  children,
}: {
  label: string;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  const syncShadow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.toggleAttribute("data-more-top", el.scrollTop > 2);
    el.toggleAttribute("data-more-bottom", el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);

  const syncBar = useCallback(() => {
    const inner = innerRef.current;
    const bar = barRef.current;
    if (!inner || !bar) return;
    const actives = [...inner.querySelectorAll<HTMLElement>('[data-nav-active="true"]')].filter(visible);
    const target = actives[actives.length - 1];
    if (!target) {
      bar.dataset.on = "0";
      return;
    }
    const top = target.getBoundingClientRect().top - inner.getBoundingClientRect().top;
    const height = target.getBoundingClientRect().height;
    bar.style.transform = `translateY(${Math.round(top + height * 0.18)}px)`;
    bar.style.height = `${Math.round(height * 0.64)}px`;
    bar.dataset.on = "1";
  }, []);

  // Aktif öğe değişince (gezinme) görünür alana getir: kullanım kartı/alt blok altında kesik kalmasın.
  const lastActive = useRef<string | null>(null);
  const revealActive = useCallback(() => {
    const scroller = scrollRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    const actives = [...inner.querySelectorAll<HTMLElement>('[data-nav-active="true"]')].filter(visible);
    const target = actives[actives.length - 1];
    const key = target?.getAttribute("href") ?? null;
    if (!target || key === lastActive.current) return;
    lastActive.current = key;
    const s = scroller.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    if (t.top < s.top + 8 || t.bottom > s.bottom - 8) target.scrollIntoView({ block: "nearest" });
  }, []);

  // Her render'dan sonra (gezinme, akordeon, arama) çubuk ve gölge güncellenir.
  useEffect(() => {
    revealActive();
    syncBar();
    syncShadow();
  });

  useEffect(() => {
    const inner = innerRef.current;
    const onChange = () => {
      syncBar();
      syncShadow();
    };
    const ro = typeof ResizeObserver !== "undefined" && inner ? new ResizeObserver(onChange) : null;
    if (ro && inner) ro.observe(inner);
    window.addEventListener(SIDEBAR_EVENT, onChange);
    window.addEventListener("resize", onChange);
    return () => {
      ro?.disconnect();
      window.removeEventListener(SIDEBAR_EVENT, onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [syncBar, syncShadow]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const links = [...(innerRef.current?.querySelectorAll<HTMLElement>(LINK_SELECTOR) ?? [])].filter(visible);
    if (links.length === 0) return;
    const idx = links.indexOf(document.activeElement as HTMLElement);
    let next = idx;
    if (e.key === "ArrowDown") next = idx < 0 ? 0 : Math.min(links.length - 1, idx + 1);
    else if (e.key === "ArrowUp") next = idx < 0 ? links.length - 1 : Math.max(0, idx - 1);
    else if (e.key === "Home") next = 0;
    else next = links.length - 1;
    e.preventDefault();
    links[next]?.focus();
    links[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <nav ref={scrollRef} aria-label={label} onScroll={syncShadow} onKeyDown={onKeyDown} className={`nav-scroll min-h-0 overflow-y-auto ${className}`}>
      <div ref={innerRef} className={`relative ${innerClassName}`}>
        <span ref={barRef} aria-hidden className="nav-bar" data-on="0" />
        {children}
      </div>
    </nav>
  );
}

/* --------------------------------- Flyout --------------------------------- */

export type FlyoutItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: { count: number; href: string; label: string; tone: "danger" | "warn" } | null;
};

const noopSubscribe = () => () => {};

export function NavFlyout({
  enabled = true,
  title,
  href,
  items = [],
  actions = [],
  children,
}: {
  /** Yalnız masaüstü kenar çubuğunda true; mobil çekmecede kapalı. */
  enabled?: boolean;
  title: string;
  href?: string;
  items?: FlyoutItem[];
  actions?: { href: string; label: string; icon: LucideIcon }[];
  children: ReactNode;
}) {
  const collapsed = useSidebarCollapsed();
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const active = enabled && collapsed;

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const openNow = () => {
    cancel();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top, left: r.right + 8 });
  };
  const closeSoon = () => {
    cancel();
    timer.current = setTimeout(() => setPos(null), 140);
  };

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos]);

  useEffect(() => () => cancel(), []);

  if (!active) return <>{children}</>;

  const hasBody = items.length > 0 || actions.length > 0;
  // Viewport dışına taşmayı önle (yüksek menüde yukarı kaydır).
  const maxTop = typeof window !== "undefined" ? Math.max(8, window.innerHeight - (hasBody ? 40 + items.length * 40 + (actions.length ? 40 + actions.length * 36 : 0) + 16 : 44) - 8) : 8;

  return (
    <div ref={wrapRef} onMouseEnter={openNow} onMouseLeave={closeSoon} onFocus={openNow} onBlur={closeSoon}>
      {children}
      {pos && mounted
        ? createPortal(
            <div
              role="group"
              aria-label={title}
              className="nav-flyout"
              style={{ top: Math.min(pos.top, maxTop), left: pos.left }}
              onMouseEnter={cancel}
              onMouseLeave={closeSoon}
            >
              {href ? (
                <Link href={href} onClick={() => setPos(null)} className="nav-flyout-title">
                  {title}
                </Link>
              ) : (
                <p className="nav-flyout-title">{title}</p>
              )}
              {items.map((it) => (
                <div key={it.href} className="relative">
                  <Link
                    href={it.href}
                    onClick={() => setPos(null)}
                    aria-current={it.active ? "page" : undefined}
                    className={`nav-flyout-item ${it.active ? "is-active" : ""} ${it.badge ? "pr-12" : ""}`}
                  >
                    <it.icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  </Link>
                  {it.badge ? (
                    <Link
                      href={it.badge.href}
                      onClick={() => setPos(null)}
                      aria-label={`${it.badge.count} ${it.badge.label}`}
                      className={`nav-badge absolute right-2 top-1/2 -translate-y-1/2 ${it.badge.tone === "danger" ? "is-danger" : "is-warn"}`}
                    >
                      {it.badge.count > 99 ? "99+" : it.badge.count}
                    </Link>
                  ) : null}
                </div>
              ))}
              {actions.length > 0 ? (
                <>
                  <p className="nav-flyout-sub">Hızlı eylemler</p>
                  {actions.map((a) => (
                    <Link key={a.href} href={a.href} onClick={() => setPos(null)} className="nav-flyout-item is-action">
                      <a.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    </Link>
                  ))}
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
