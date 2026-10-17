"use client";

import Link from "@/components/ui/smart-link";
import type { RefObject } from "react";
import type { FlyoutItem } from "./nav-kit";

export type NavFlyoutPanelProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  title: string;
  href?: string;
  items: FlyoutItem[];
  actions: { href: string; label: string; icon: FlyoutItem["icon"] }[];
  top: number;
  left: number;
  onCancel: () => void;
  onCloseSoon: () => void;
  onClose: () => void;
};

/**
 * Daraltılmış masaüstü menüsünde satırın açılır paneli (görünüm). Durum, zamanlayıcılar ve klavye `NavFlyout`'tadır
 * (nav-kit.tsx); bu parça yalnız daraltılmış menüde boşta / ilk üzerine gelişte iner.
 */
export function NavFlyoutPanel({ panelRef, title, href, items, actions, top, left, onCancel, onCloseSoon, onClose }: NavFlyoutPanelProps) {
  return (
    <div
      ref={panelRef}
      role="group"
      aria-label={title}
      className="nav-flyout"
      style={{ top, left }}
      onMouseEnter={onCancel}
      onMouseLeave={onCloseSoon}
    >
      {href ? (
        <Link href={href} onClick={onClose} className="nav-flyout-title">
          {title}
        </Link>
      ) : (
        <p className="nav-flyout-title">{title}</p>
      )}
      {items.map((it) => (
        <div key={it.href}>
          <div className="relative">
            <Link
              href={it.href}
              onClick={onClose}
              aria-current={it.active ? "page" : undefined}
              className={`nav-flyout-item ${it.active ? "is-active" : ""} ${it.badge ? "pr-12" : ""}`}
            >
              <it.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </Link>
            {it.badge ? (
              <Link
                href={it.badge.href}
                onClick={onClose}
                aria-label={`${it.badge.count} ${it.badge.label}`}
                className={`nav-badge absolute right-2 top-1/2 -translate-y-1/2 ${it.badge.tone === "danger" ? "is-danger" : "is-warn"}`}
              >
                {it.badge.count > 99 ? "99+" : it.badge.count}
              </Link>
            ) : null}
          </div>
          {it.children?.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              onClick={onClose}
              aria-current={c.active ? "page" : undefined}
              className={`nav-flyout-item ml-6 min-h-8 text-[0.8125rem] ${c.active ? "is-active" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
            </Link>
          ))}
        </div>
      ))}
      {actions.length > 0 ? (
        <>
          <p className="nav-flyout-sub">Hızlı eylemler</p>
          {actions.map((a) => (
            <Link key={a.href} href={a.href} onClick={onClose} className="nav-flyout-item is-action">
              <a.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
            </Link>
          ))}
        </>
      ) : null}
    </div>
  );
}
