"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { bulkUpdatePropertyStatus } from "@/app/actions/bulk-property";
import { BulkBar } from "@/components/ui/list-kit";

/**
 * Portföy listesinde toplu seçim + toplu durum güncelleme.
 *
 * Satırlar sunucuda çizilir (kapak, kapsüller, eylemler); seçim durumu istemci ister.
 * Bu yüzden satıra gömülen küçük checkbox parçaları ile tablonun üstündeki çubuk,
 * ortak bir Context üzerinden konuşur (müşteri listesiyle aynı desen).
 * Eylem kapısı sunucuda `properties.edit`; sayfa da yalnız bu izinle çubuğu çizer.
 */
const STATUS_OPTIONS = [
  { value: "live", label: "Yayında" },
  { value: "draft", label: "Taslak" },
  { value: "reserved", label: "Rezerve" },
  { value: "passive", label: "Pasif" },
  { value: "withdrawn", label: "Vazgeçildi" },
  { value: "archived", label: "Arşiv" },
];

type Ctx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
};
const SelectionCtx = createContext<Ctx | null>(null);

function useSelection(): Ctx {
  const ctx = useContext(SelectionCtx);
  if (!ctx) throw new Error("PropertyBulkProvider içinde kullanılmalı");
  return ctx;
}

export function PropertyBulkProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setAll = useCallback((ids: string[], on: boolean) => {
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
  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

/** Başlık hücresi — sayfadaki tüm satırları seç/bırak. */
export function PropertySelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      disabled={ids.length === 0}
      onChange={() => setAll(ids, !allSelected)}
      aria-label={allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tüm portföyleri seç"}
      className="h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

/** Satır checkbox'ı — relative z-10: satırı kaplayan overlay linkin üstünde kalır. */
export function PropertyRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={`${name} portföyünü seç`}
      className="relative z-10 h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

/** Seçim varken beliren toplu durum çubuğu. */
export function PropertyBulkBar() {
  const { selected, clear } = useSelection();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string; updatedCount?: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = (status: string) => {
    setOpen(false);
    if (!selected.size) return;
    setResult(null);
    startTransition(async () => {
      const res = await bulkUpdatePropertyStatus([...selected], status);
      setResult(res);
      if (res.ok) clear();
    });
  };

  return (
    <div className="space-y-2">
      {selected.size > 0 ? (
        <BulkBar count={selected.size} noun="portföy" onClear={clear}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((s) => !s)}
              disabled={pending}
              aria-expanded={open}
              className="focus-ring press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              Durum değiştir
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </button>
            {open ? (
              <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-lg)]">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => apply(s.value)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-text transition hover:bg-canvas"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </BulkBar>
      ) : null}
      {result?.ok ? (
        <p role="status" className="tone-success rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold">
          {result.updatedCount} portföy güncellendi.
        </p>
      ) : null}
      {result?.error ? (
        <p role="alert" className="tone-danger rounded-[var(--radius-control)] px-4 py-2 text-sm">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}
