"use client";

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { lazyPanel } from "@/lib/lazy-panel";
import type { ZekaSurface } from "@/lib/ai/zeka/types";
import type { ZekaDockProps } from "./zeka-dock";
import "./zeka-fab.css";

/**
 * Yüzen Zeka başlatıcısı (sağ alt, yuvarlak küre) — KÜÇÜK ADA: satır içi SVG + birkaç satır CSS. Sohbet penceresi
 * (`ZekaDock`) ilk tıkta / Ctrl+J ile iner, üstüne gelince / odakta önceden indirilir. Açıkken düğme kapatma (×) olur.
 * Yol `usePathname` ile (arama parametresi okunmaz). PUBLIC'te düğme `/sor?from=` BAĞLANTISIDIR (statik ana sayfa
 * JS'siz); hidrasyondan sonra pencere burada açılır. Çakışma kuralları zeka-fab.css'te.
 */
const noopSub = () => () => {};
const dock = lazyPanel(() => import("./zeka-dock").then((m) => m.ZekaDock));
const SEEN = "zeka_seen";
const unseen = () => {
  try {
    return !window.localStorage.getItem(SEEN);
  } catch {
    return false;
  }
};

export type ZekaFabProps = {
  surface: ZekaSurface;
  role?: string | null;
  /** Pencere adı (vitrin: "İlan asistanı"). Düğmenin erişilebilir adı her yüzeyde "Zeka'ya sor". */
  title?: string;
  placeholder?: string;
  extraBody?: Record<string, unknown>;
  recentsKey?: string | null;
  userName?: string | null;
};

export function ZekaFab({ surface, role = null, title, placeholder, extraBody, recentsKey = null, userName = null }: ZekaFabProps) {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [Dock, setDock] = useState<ComponentType<ZekaDockProps> | null>(null);
  const [body] = useState(extraBody);
  const btn = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const hydrated = useSyncExternalStore(noopSub, () => true, () => false);
  const fresh = useSyncExternalStore(noopSub, unseen, () => false);

  const toggle = useCallback(() => {
    setDock((cur: ComponentType<ZekaDockProps> | null) => cur ?? dock.resolve());
    setOpen((o) => !o);
    setSeen(true);
    try {
      window.localStorage.setItem(SEEN, "1");
    } catch {}
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => btn.current?.focus());
  }, []);

  // Ctrl+J (macOS: Cmd+J) her sayfada pencereyi açar/kapatır.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const icon = (
    <>
      <span className="zk-fab-orb" aria-hidden="true" />
      <svg className="zk-fab-ico" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path className="zk-spark-a" fill="currentColor" d="M10 2.5l1.7 4.9a3 3 0 0 0 1.9 1.9l4.9 1.7-4.9 1.7a3 3 0 0 0-1.9 1.9L10 19.5l-1.7-4.9a3 3 0 0 0-1.9-1.9L1.5 11l4.9-1.7a3 3 0 0 0 1.9-1.9z" />
        <path className="zk-spark-b" fill="currentColor" d="M19 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
        <path className="zk-spark-c" fill="currentColor" d="M18.5 2l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
      </svg>
      <svg className="zk-fab-x" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      {fresh && !seen && !open ? <span className="zk-fab-dot" aria-hidden="true" /> : null}
      <span className="zk-fab-label">Zeka&apos;ya sor</span>
    </>
  );

  return (
    <>
      {surface === "public" ? (
        <a
          ref={btn}
          href={`/sor?from=${encodeURIComponent(pathname)}`}
          className="zk-fab"
          data-zeka-fab={surface}
          data-open={open ? "" : undefined}
          data-tip="Zeka'ya sor"
          role={hydrated ? "button" : undefined}
          aria-label="Zeka'ya sor"
          aria-haspopup={hydrated ? "dialog" : undefined}
          aria-expanded={hydrated ? open : undefined}
          aria-keyshortcuts={hydrated ? "Control+J" : undefined}
          onClick={(e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            toggle();
          }}
          onPointerEnter={dock.preload}
          onFocus={dock.preload}
        >
          {icon}
        </a>
      ) : (
        <button
          ref={btn}
          type="button"
          className="zk-fab"
          data-zeka-fab={surface}
          data-open={open ? "" : undefined}
          data-tip="Zeka'ya sor · Ctrl+J"
          aria-label="Zeka'ya sor"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="Control+J"
          onClick={toggle}
          onPointerEnter={dock.preload}
          onFocus={dock.preload}
        >
          {icon}
        </button>
      )}
      {open && Dock ? (
        <Suspense fallback={null}>
          <Dock surface={surface} page={pathname} role={role} title={title} placeholder={placeholder} extraBody={body} recentsKey={recentsKey} userName={userName} onClose={close} />
        </Suspense>
      ) : null}
    </>
  );
}
