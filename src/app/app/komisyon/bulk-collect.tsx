"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { markCommissionsPaidBulk } from "@/app/actions/commissions";
import { useToast } from "@/components/app/toast-provider";

/**
 * Toplu tahsilat seçimi — sunucu tarafında render edilen defter satırlarına
 * checkbox eklemek için context tabanlı client adaları: Provider sayfada
 * server children'ı sarar, Checkbox her satırda, Bar liste üstünde durur.
 */

type BulkCtx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  clear: () => void;
};

const Ctx = createContext<BulkCtx | null>(null);

export function BulkCollectProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const value: BulkCtx = {
    selected,
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    setAll: (ids) => setSelected(new Set(ids)),
    clear: () => setSelected(new Set()),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function BulkCollectCheckbox({ id, label }: { id: string; label?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <input
      type="checkbox"
      checked={ctx.selected.has(id)}
      onChange={() => ctx.toggle(id)}
      aria-label={label ?? "Kaydı seç"}
      className="focus-ring relative z-10 h-4 w-4 cursor-pointer rounded border-line accent-[var(--brand-600)]"
    />
  );
}

/** Seçim çubuğu — tümünü seç/bırak + "Seçilenleri tahsil edildi işaretle". */
export function BulkCollectBar({ allIds }: { allIds: string[] }) {
  const ctx = useContext(Ctx);
  const { push } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!ctx || allIds.length === 0) return null;

  const count = ctx.selected.size;
  const allSelected = count > 0 && allIds.every((id) => ctx.selected.has(id));

  async function collect() {
    if (!ctx || ctx.selected.size === 0) return;
    setBusy(true);
    const res = await markCommissionsPaidBulk(Array.from(ctx.selected));
    setBusy(false);
    if (res.error) push(res.error, "err");
    else {
      push(`${res.updated ?? 0} komisyon tahsil edildi olarak işaretlendi`, "ok");
      ctx.clear();
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-2.5">
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => (allSelected ? ctx.clear() : ctx.setAll(allIds))}
          aria-label="Bekleyen tüm kayıtları seç"
          className="focus-ring h-4 w-4 cursor-pointer rounded border-line accent-[var(--brand-600)]"
        />
        Tümünü seç
      </label>
      {count > 0 ? (
        <>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
            {count} seçili
          </span>
          <button
            type="button"
            onClick={collect}
            disabled={busy}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-mint-500/15 px-3 py-1.5 text-[11px] font-bold text-mint-700 transition hover:bg-mint-500/25 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Seçilenleri tahsil edildi işaretle
          </button>
          <button
            type="button"
            onClick={ctx.clear}
            disabled={busy}
            className="focus-ring inline-flex items-center gap-1 rounded-[9px] px-2 py-1.5 text-[11px] font-semibold text-text-muted transition hover:text-danger-500 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Seçimi bırak
          </button>
        </>
      ) : (
        <span className="text-[11px] text-text-faint">
          Bekleyen kayıtları işaretleyip topluca tahsil edin
        </span>
      )}
    </div>
  );
}
