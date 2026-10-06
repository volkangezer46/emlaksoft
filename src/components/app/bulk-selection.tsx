"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Liste toplu seçimi (genel): satırlar sunucuda çizilir, yalnız onay kutuları ve toplu işlem
 * çubuğu istemcidir. Anlaşma, gider, teklif, sözleşme ve onay listeleri aynı sağlayıcıyı kullanır
 * (talep listesinin `demand-bulk.tsx` deseninin genelleştirilmiş hali).
 */
type SelectionCtx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: readonly string[], on: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<SelectionCtx | null>(null);

export function useBulkSelection(): SelectionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("BulkSelectionProvider içinde kullanılmalı");
  return ctx;
}

export function BulkSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setAll = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const value = useMemo(() => ({ selected, toggle, setAll, clear }), [selected, toggle, setAll, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function BulkSelectAll({ ids, noun }: { ids: readonly string[]; noun: string }) {
  const { selected, setAll } = useBulkSelection();
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={all}
      disabled={ids.length === 0}
      onChange={() => setAll(ids, !all)}
      aria-label={all ? "Sayfadaki seçimi kaldır" : `Sayfadaki tüm ${noun} kayıtlarını seç`}
      className="h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

export function BulkRowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useBulkSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label} seç`}
      className="relative z-10 h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}
