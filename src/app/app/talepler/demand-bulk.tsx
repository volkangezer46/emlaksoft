"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { CheckCircle2, RotateCcw, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { bulkDeleteDemands, bulkSetDemandStatus, getDemandDeleteImpact, type DemandDeleteImpact } from "@/app/actions/demands";
import { useToast } from "@/components/app/toast-provider";

/**
 * Talep listesinde toplu seçim + toplu durum değiştirme (masaüstü tablo ve mobil kart aynı bağlamı kullanır).
 * Satırlar sunucuda çizilir; yalnız onay kutuları ve eylem çubuğu istemcidir.
 */

type SelectionCtx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<SelectionCtx | null>(null);

function useSelection(): SelectionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("DemandBulkProvider içinde kullanılmalı");
  return ctx;
}

export function DemandBulkProvider({ children }: { children: React.ReactNode }) {
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
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function DemandSelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      disabled={ids.length === 0}
      onChange={() => setAll(ids, !allSelected)}
      aria-label={allSelected ? "Sayfadaki seçimi kaldır" : "Sayfadaki tüm talepleri seç"}
      className="h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

export function DemandRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={`${name} talebini seç`}
      className="relative z-10 h-4 w-4 cursor-pointer accent-brand-600"
    />
  );
}

export function DemandBulkBar({ canDelete = false }: { canDelete?: boolean }) {
  const { selected, clear } = useSelection();
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();
  const [impact, setImpact] = useState<DemandDeleteImpact | null>(null);
  const [pending, startTransition] = useTransition();

  if (selected.size === 0) return null;
  const ids = [...selected];

  const run = (status: "closed" | "active", doneText: string) => {
    setError(null);
    startTransition(async () => {
      const res = await bulkSetDemandStatus(ids, status);
      if (res.error) {
        setError(res.error);
        return;
      }
      clear();
      push(`${res.updatedCount ?? 0} talep ${doneText}`, "ok");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/[0.04] px-4 py-2.5">
      <span className="text-sm font-semibold text-brand-700">{selected.size} talep seçildi</span>
      <Button size="sm" loading={pending} onClick={() => run("active", "yeniden açıldı")}>
        <RotateCcw className="h-3.5 w-3.5" /> Aktif yap
      </Button>
      <Button size="sm" variant="secondary" loading={pending} onClick={() => run("closed", "kapatıldı")}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Kapat
      </Button>
      {canDelete ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="danger" onClick={() => void getDemandDeleteImpact(ids).then(setImpact)}>
              <Trash2 className="h-3.5 w-3.5" /> Sil
            </Button>
          }
          title={`${ids.length} talep kalıcı silinsin mi?`}
          description={
            `Talepler çöp kutusuna girmez, geri alınamaz.` +
            (impact && impact.openDemands > 0 ? ` ${impact.openDemands} tanesi hâlâ açık (kapatmak için "Kapat" kullanabilirsiniz).` : "") +
            (impact && impact.networkShares > 0 ? ` ${impact.networkShares} talebin ağ paylaşımı da kalkar.` : "")
          }
          confirmLabel="Kalıcı sil"
          onConfirm={async () => {
            const res = await bulkDeleteDemands(ids);
            if (res.error) setError(res.error);
            else {
              clear();
              push(`${res.deletedCount ?? 0} talep silindi`, "ok");
            }
          }}
        />
      ) : null}
      {error ? (
        <span className="text-xs font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          clear();
          setError(null);
        }}
        className="ml-auto grid min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-line"
        aria-label="Seçimi temizle"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
