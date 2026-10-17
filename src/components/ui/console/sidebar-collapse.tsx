"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ChevronsLeft, ChevronsRight, PanelLeftClose } from "lucide-react";

/**
 * Yan menü daraltma düğmesi. Durum `<html data-sidebar="collapsed">` üzerinde tutulur
 * (CSS: src/app/console.css); tercih yalnız localStorage'da saklanır (çerez yok) ve
 * ilk boyamadan önce `SidebarBoot` ile uygulanır, böylece genişlik sıçramaz.
 * Kısayol: Ctrl/Cmd+B (her yerde) ve `[` (yazı alanında çalışmaz). Menüyü daraltan TEK denetim budur.
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

/** Tablet ikon rayı (console-shell.css, 768–1023 px): imleçli cihazda uçuş paneli/ipucu burada da çıkar. */
const TABLET_RAIL_QUERY = "(min-width: 768px) and (max-width: 1023.98px) and (hover: hover)";
function subscribeRail(cb: () => void) {
  const mq = window.matchMedia(TABLET_RAIL_QUERY);
  mq.addEventListener("change", cb);
  const off = subscribe(cb);
  return () => {
    mq.removeEventListener("change", cb);
    off();
  };
}
const readRail = () => read() || window.matchMedia(TABLET_RAIL_QUERY).matches;

/** Yan menü ikon modunda mı (masaüstü daraltılmış ya da tablet rayı)? Flyout/tooltip yalnız bu modda çıkar. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribeRail, readRail, () => false);
}

export function SidebarCollapseButton({ className = "" }: { className?: string }) {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+B (yaygın düzenleyici kısayolu) her yerde; "[" yalnız yazı alanı dışında.
      const modB = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b";
      if (modB) {
        e.preventDefault();
        setCollapsed(!read());
        return;
      }
      if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      setCollapsed(!read());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  const label = collapsed ? "Menüyü genişlet" : "Menüyü daralt";
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-label={label}
      aria-pressed={collapsed}
      title={`${label} (Ctrl+B)`}
      className={`sb-toggle focus-ring h-9 w-9 touch:h-11 touch:w-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/6 text-white/80 transition-colors hover:bg-white/15 hover:text-white ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * "Menüyü daralt" satırı: geniş menünün SONUNDA (listeyle kayar; sabit alt bölüm yok). Kısayol dinleyicisi yalnız
 * başlıktaki düğmede (iki dinleyici Ctrl+B'yi iki kez çevirirdi); daraltılmış rayda genişletme başlıktaki düğmededir.
 */
export function SidebarCollapseRow({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => setCollapsed(true)} aria-label="Menüyü daralt" title="Menüyü daralt (Ctrl+B)" className={className}>
      <PanelLeftClose className="h-[18px] w-[18px] shrink-0 text-white/65" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Menüyü daralt</span>
      <kbd className="sb-kbd hidden shrink-0 lg:inline">Ctrl B</kbd>
    </button>
  );
}
