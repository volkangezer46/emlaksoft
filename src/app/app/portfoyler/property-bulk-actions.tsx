"use client";

import { RowCheckbox } from "@/components/app/bulk-selection";
import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { ChevronDown, Loader2, UserCog } from "lucide-react";
import { bulkAssignProperties, bulkUpdatePropertyStatus } from "@/app/actions/bulk-property";
import { BulkBar } from "@/components/ui/list-kit";
import { Button } from "@/components/ui/button";
import { PersonSelect } from "@/components/ui/person-select";
import type { AssignableAdvisor } from "@/lib/team/assignable-roles";

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
    <RowCheckbox
      checked={allSelected}
      disabled={ids.length === 0}
      onToggle={() => setAll(ids, !allSelected)}
      label={allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tüm portföyleri seç"}
    />
  );
}

/** Satır checkbox'ı — ortak `RowCheckbox` (44 px dokunma alanı; overlay linkin üstünde kalır). */
export function PropertyRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return <RowCheckbox checked={selected.has(id)} onToggle={() => toggle(id)} label={`${name} portföyünü seç`} />;
}

/** Seçim varken beliren toplu durum + sorumlu değiştirme çubuğu. */
export function PropertyBulkBar({ advisors = [] }: { advisors?: AssignableAdvisor[] }) {
  const { selected, clear } = useSelection();
  const [open, setOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [advisor, setAdvisor] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; updatedCount?: number; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const assign = () => {
    if (!selected.size || !advisor) return;
    setResult(null);
    const name = advisors.find((a) => a.id === advisor)?.full_name ?? "seçilen danışman";
    startTransition(async () => {
      const res = await bulkAssignProperties([...selected], advisor);
      setResult(res.ok ? { ...res, message: `${res.updatedCount ?? 0} portföy ${name} danışmanına devredildi.` } : res);
      if (res.ok) {
        setAssignOpen(false);
        setAdvisor("");
        clear();
      }
    });
  };

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
              className="focus-ring press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 touch:min-h-11"
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
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-text transition hover:bg-canvas touch:min-h-11"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {advisors.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={assignOpen}
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setAdvisor("");
                setAssignOpen((s) => !s);
              }}
            >
              <UserCog aria-hidden="true" className="h-3.5 w-3.5" /> Sorumlu değiştir
            </Button>
          ) : null}
        </BulkBar>
      ) : null}
      {selected.size > 0 && assignOpen ? (
        <section aria-label="Sorumlu değiştir" className="rounded-[var(--radius-card)] border border-brand-300 bg-surface p-4">
          <p className="text-sm font-semibold text-ink-950">Sorumlu değiştir</p>
          <p className="mt-0.5 text-xs text-text-muted">{selected.size} portföy seçili — hepsi aynı danışmana devredilir.</p>
          <label htmlFor="property-bulk-assign" className="mb-1.5 mt-3 block text-xs font-semibold text-text-muted">
            Danışman
          </label>
          <PersonSelect
            id="property-bulk-assign"
            className="max-w-sm"
            value={advisor}
            onValueChange={setAdvisor}
            people={advisors.map((a) => ({ id: a.id, name: a.full_name }))}
            featuredIds={advisors.filter((a) => a.featured).map((a) => a.id)}
            emptyLabel="Danışman seçin"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAssignOpen(false)}>Vazgeç</Button>
            <Button size="sm" loading={pending} disabled={!advisor} onClick={assign}>Ata</Button>
          </div>
        </section>
      ) : null}
      {result?.ok ? (
        <p role="status" className="tone-success rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold">
          {result.message ?? `${result.updatedCount} portföy güncellendi.`}
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
