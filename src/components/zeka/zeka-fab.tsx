"use client";

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { lazyPanel } from "@/lib/lazy-panel";
import type { ZekaSurface } from "@/lib/ai/zeka/types";
import type { ZekaDockProps } from "./zeka-panel";
import "./zeka-fab.css";

/**
 * Yüzen "Zeka'ya sor" düğmesi — KÜÇÜK ADA. İlk yük paketine yalnız bu düğme (satır içi SVG, ikon kütüphanesi yok) ve
 * birkaç satır CSS girer; sohbet penceresi (`ZekaDock`, zeka-panel.tsx) ilk TIKTA (ya da Ctrl+J) iner, üstüne gelince /
 * odakta önceden indirilir. Sayfa bağlamı `usePathname` ile (arama parametresi okunmaz; layout'ta Suspense gerektirmez).
 * Yerleşim ve çakışma kuralları zeka-fab.css'te (alt gezinme, kayıt çubuğu, form çubuğu, bildirimler).
 * PUBLIC yüzeyde düğme bir BAĞLANTIDIR (`/sor?from=<yol>`): statik ana sayfa Next betiği taşımaz (hidrasyon yok), bağlantı
 * yine çalışır ve tam sayfa sohbeti açar. Hidrasyondan sonra tık engellenir, pencere burada açılır (rol "button" olur).
 * /app, /admin ve vitrin her zaman hidrate olur: orada gerçek <button>.
 */
const noopSub = () => () => {};
const dock = lazyPanel(() => import("./zeka-panel").then((m) => m.ZekaDock));

export type ZekaFabProps = {
  surface: ZekaSurface;
  role?: string | null;
  /** Pencere başlığı (vitrin: "İlan asistanı"). Düğmenin erişilebilir adı her yüzeyde "Zeka'ya sor". */
  title?: string;
  placeholder?: string;
  extraBody?: Record<string, unknown>;
  recentsKey?: string | null;
};

export function ZekaFab({ surface, role = null, title, placeholder, extraBody, recentsKey = null }: ZekaFabProps) {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [Dock, setDock] = useState<ComponentType<ZekaDockProps> | null>(null);
  const [body] = useState(extraBody);
  const btn = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const hydrated = useSyncExternalStore(noopSub, () => true, () => false);

  const toggle = useCallback(() => {
    setDock((cur: ComponentType<ZekaDockProps> | null) => cur ?? dock.resolve());
    setOpen((o) => !o);
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
      <svg className="zk-fab-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path className="zk-spark-a" fill="currentColor" d="M10 2.5l1.7 4.9a3 3 0 0 0 1.9 1.9l4.9 1.7-4.9 1.7a3 3 0 0 0-1.9 1.9L10 19.5l-1.7-4.9a3 3 0 0 0-1.9-1.9L1.5 11l4.9-1.7a3 3 0 0 0 1.9-1.9z" />
        <path className="zk-spark-b" fill="currentColor" d="M19 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
        <path className="zk-spark-c" fill="currentColor" d="M18.5 2l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
      </svg>
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
          role={hydrated ? "button" : undefined}
          aria-label="Zeka'ya sor"
          aria-haspopup={hydrated ? "dialog" : undefined}
          aria-expanded={hydrated ? open : undefined}
          aria-keyshortcuts={hydrated ? "Control+J" : undefined}
          title="Zeka'ya sor"
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
          aria-label="Zeka'ya sor"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="Control+J"
          title="Zeka'ya sor (Ctrl+J)"
          onClick={toggle}
          onPointerEnter={dock.preload}
          onFocus={dock.preload}
        >
          {icon}
        </button>
      )}
      {open && Dock ? (
        <Suspense fallback={null}>
          <Dock surface={surface} page={pathname} role={role} title={title} placeholder={placeholder} extraBody={body} recentsKey={recentsKey} onClose={close} />
        </Suspense>
      ) : null}
    </>
  );
}
