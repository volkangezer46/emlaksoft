"use client";

import { useEffect, useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * Yan menü daraltma düğmesi. Durum `<html data-sidebar="collapsed">` üzerinde tutulur
 * (CSS: src/app/console.css); tercih yalnız localStorage'da saklanır (çerez yok) ve
 * ilk boyamadan önce `SidebarBoot` ile uygulanır, böylece genişlik sıçramaz.
 * Kısayol: `[` (yazı alanında çalışmaz).
 */
const KEY = "es-sidebar";
export const SIDEBAR_EVENT = "es-sidebar-change";
const EVENT = SIDEBAR_EVENT;

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
const read = () => document.documentElement.dataset.sidebar === "collapsed";

function setCollapsed(next: boolean) {
  if (next) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  try {
    window.localStorage.setItem(KEY, next ? "collapsed" : "expanded");
  } catch {
    // localStorage kapalı: tercih yalnız bu oturumda kalır.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Masaüstü yan menü ikon modunda mı? (flyout/tooltip yalnız bu modda çıkar) */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function SidebarCollapseButton({ className = "" }: { className?: string }) {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      setCollapsed(!read());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "Menüyü genişlet" : "Menüyü daralt";
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-label={label}
      aria-pressed={collapsed}
      title={`${label} ([)`}
      className={`sb-toggle focus-ring h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80 transition-colors hover:bg-white/15 hover:text-white ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
