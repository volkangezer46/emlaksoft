"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Settings2 } from "lucide-react";

const STORAGE_KEY = "dashboard_hidden_widgets";
const EMPTY: string[] = [];

/* ------------------------------------------------------------------
   localStorage destekli küçük dış store — useSyncExternalStore ile
   okunur: SSR/ilk hydrate'te boş (tüm paneller görünür), hemen ardından
   gerçek liste gelir. Hydration hatası üretmeden tek seferlik geçiş.
   ------------------------------------------------------------------ */
let cachedRaw: string | null = null;
let cachedList: string[] = EMPTY;
const listeners = new Set<() => void>();

function readHidden(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      cachedList = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : EMPTY;
    } catch {
      cachedList = EMPTY;
    }
  }
  return cachedList;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function writeHidden(next: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // depolama kapalı/dolu — yalnız oturum içi çalışır
    cachedRaw = "__memory__";
    cachedList = next;
  }
  listeners.forEach((l) => l());
}

type WidgetCtxValue = {
  edit: boolean;
  setEdit: (v: boolean) => void;
  hidden: string[];
  toggle: (id: string) => void;
};

const WidgetCtx = createContext<WidgetCtxValue>({
  edit: false,
  setEdit: () => {},
  hidden: EMPTY,
  toggle: () => {},
});

/**
 * Dashboard kişiselleştirme sağlayıcısı — gizlenen panel kimlikleri
 * localStorage'da (dashboard_hidden_widgets). Sunucu içerik children
 * olarak sarılır: SSR'da her panel görünür, hydrate'te gizliler kalkar.
 */
export function DashboardWidgetProvider({ children }: { children: React.ReactNode }) {
  const [edit, setEdit] = useState(false);
  const hidden = useSyncExternalStore(subscribe, readHidden, () => EMPTY);

  const toggle = useCallback(
    (id: string) => {
      const cur = readHidden();
      writeHidden(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    },
    [],
  );

  return (
    <WidgetCtx.Provider value={{ edit, setEdit, hidden, toggle }}>{children}</WidgetCtx.Provider>
  );
}

/** Sağ üst "Düzenle" anahtarı — panel gizle/göster modunu açıp kapatır. */
export function WidgetEditToggle({ className = "" }: { className?: string }) {
  const { edit, setEdit, hidden } = useContext(WidgetCtx);
  return (
    <button
      type="button"
      onClick={() => setEdit(!edit)}
      title="Panelleri gizle / göster"
      className={`focus-ring press inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-semibold transition ${className}`}
    >
      <Settings2 className="h-3.5 w-3.5" />
      {edit ? "Bitti" : "Düzenle"}
      {!edit && hidden.length > 0 ? (
        <span className="rounded-full bg-white/15 px-1.5 text-[11px] tabular-nums">{hidden.length}</span>
      ) : null}
    </button>
  );
}

/**
 * Gizlenebilir panel sarmalayıcısı. Düzenleme modunda köşede göz ikonu;
 * normal modda gizli paneller hiç render edilmez.
 */
export function Widget({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { edit, hidden, toggle } = useContext(WidgetCtx);
  const isHidden = hidden.includes(id);

  if (isHidden && !edit) return null;

  return (
    <div
      className={`relative ${className} ${
        edit ? "rounded-[20px] outline-2 outline-dashed outline-brand-300/70 outline-offset-2" : ""
      } ${isHidden ? "opacity-45 grayscale" : ""}`}
    >
      {edit ? (
        <button
          type="button"
          onClick={() => toggle(id)}
          title={isHidden ? "Paneli göster" : "Paneli gizle"}
          aria-label={isHidden ? "Paneli göster" : "Paneli gizle"}
          className="focus-ring press absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-[9px] border border-line bg-surface text-text-muted shadow-elev-2 transition hover:border-brand-300 hover:text-brand-600"
        >
          {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      ) : null}
      {children}
    </div>
  );
}
