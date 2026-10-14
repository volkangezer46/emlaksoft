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
    <RowCheckbox
      checked={all}
      disabled={ids.length === 0}
      onToggle={() => setAll(ids, !all)}
      label={all ? "Sayfadaki seçimi kaldır" : `Sayfadaki tüm ${noun} kayıtlarını seç`}
    />
  );
}

/**
 * Satır onay kutusu (tüm toplu seçimli listelerin ORTAK görünümü; başlıktaki "tümünü seç" de). Görsel kutu 16 px kalır;
 * dokunmatik/dar ekranda 44 px'lik `label` dokunma alanı negatif kenar boşluğuyla satır yüksekliğini büyütmeden kutuyu sarar.
 * `relative z-10`: satırı kaplayan bindirme bağlantısının (absolute inset-0) üstünde kalır; tık satıra yayılmaz.
 */
export function RowCheckbox({ checked, onToggle, label, disabled }: { checked: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      className="relative z-10 inline-grid cursor-pointer place-items-center touch:-m-[14px] touch:size-11"
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} aria-label={label} className="h-4 w-4 cursor-pointer accent-brand-600" />
    </label>
  );
}

export function BulkRowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useBulkSelection();
  return <RowCheckbox checked={selected.has(id)} onToggle={() => toggle(id)} label={`${label} seç`} />;
}
