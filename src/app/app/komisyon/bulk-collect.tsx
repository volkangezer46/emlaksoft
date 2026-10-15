"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { markCommissionsPaidBulk, retryCommissionCash } from "@/app/actions/commissions";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
      className="focus-ring relative z-10 h-4 w-4 cursor-pointer rounded border-line accent-[var(--accent)]"
    />
  );
}

/** Seçim çubuğu — tümünü seç/bırak + "Seçilenleri tahsil edildi işaretle". */
export function BulkCollectBar({ allIds }: { allIds: string[] }) {
  const ctx = useContext(Ctx);
  const { push } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState("");
  // SK6/B109: ofiste hesap varsa hesap zorunlu; hesap yoksa (0) "kasaya yazmadan işaretle" bilinçli onayı.
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [confirmNoCash, setConfirmNoCash] = useState(false);
  // Tahsilat kaydedildi ama kasa hareketi yazılamayanlar: uyarı + "Yeniden dene" (aynı hesapla, idempotent).
  const [cashFailed, setCashFailed] = useState<{ ids: string[]; accountId: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  if (!ctx || (allIds.length === 0 && !cashFailed)) return null;

  async function retry() {
    if (!cashFailed) return;
    setRetrying(true);
    const res = await retryCommissionCash(cashFailed.ids, cashFailed.accountId);
    setRetrying(false);
    if (res.failedIds.length > 0) {
      setCashFailed({ ids: res.failedIds, accountId: cashFailed.accountId });
      push(`${res.failedIds.length} tahsilat kasaya yazılamadı`, "err");
    } else if (res.error) {
      push(res.error, "err");
    } else {
      setCashFailed(null);
      push(`${res.recorded} tahsilat kasaya yazıldı`, "ok");
      router.refresh();
    }
  }

  const count = ctx.selected.size;
  const allSelected = count > 0 && allIds.every((id) => ctx.selected.has(id));

  const needAccount = accountCount !== null && accountCount > 0 && !accountId;

  async function collect(skipCash = false) {
    if (!ctx || ctx.selected.size === 0) return;
    if (needAccount) {
      push("Tahsilatın girdiği hesabı seçin", "err");
      return;
    }
    if (accountCount === 0 && !skipCash) {
      setConfirmNoCash(true);
      return;
    }
    setBusy(true);
    const res = await markCommissionsPaidBulk(Array.from(ctx.selected), accountId || null, { skipCash });
    setBusy(false);
    if (res.needsCashConfirm) setConfirmNoCash(true);
    else if (res.error) push(res.error, "err");
    else {
      push(`${res.updated ?? 0} komisyon tahsil edildi olarak işaretlendi`, "ok");
      if (res.cashFailedCount > 0) {
        setCashFailed({ ids: res.cashFailedIds, accountId });
        push(`${res.cashFailedCount} tahsilat kasaya yazılamadı`, "err");
      } else if (res.info) push(res.info, "err");
      ctx.clear();
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-2.5">
      {cashFailed ? (
        <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--viz-neg)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[color:var(--viz-neg)]">
          <span>{cashFailed.ids.length} tahsilat kasaya yazılamadı</span>
          <Button type="button" variant="outline" size="sm" onClick={retry} loading={retrying} disabled={retrying} className="touch:h-11">
            Yeniden dene
          </Button>
        </div>
      ) : null}
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => (allSelected ? ctx.clear() : ctx.setAll(allIds))}
          aria-label="Bekleyen tüm kayıtları seç"
          className="focus-ring h-4 w-4 cursor-pointer rounded border-line accent-[var(--accent)]"
        />
        Tümünü seç
      </label>
      {count > 0 ? (
        <>
          <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-xs font-bold text-accent-text">
            {count} seçili
          </span>
          <FinanceAccountPicker value={accountId} onChange={setAccountId} required onAccountsLoaded={setAccountCount} />
          <button
            type="button"
            onClick={() => collect()}
            disabled={busy || needAccount}
            title={needAccount ? "Önce tahsilatın girdiği hesabı seçin" : undefined}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)] px-3 py-1.5 text-xs font-bold text-[color:var(--viz-pos)] transition hover:bg-[color-mix(in_srgb,var(--viz-pos)_22%,transparent)] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Seçilenleri tahsil edildi işaretle
          </button>
          <button
            type="button"
            onClick={ctx.clear}
            disabled={busy}
            className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-1.5 text-xs font-semibold text-text-muted transition hover:text-[color:var(--viz-neg)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Seçimi bırak
          </button>
          <ConfirmDialog
            open={confirmNoCash}
            onOpenChange={setConfirmNoCash}
            title="Kasaya yazmadan işaretle"
            description="Ofiste kasa ya da banka hesabı yok. Seçilen komisyonlar tahsil edildi işaretlenir ama kasaya hareket yazılmaz. Hesap açınca Muhasebe > Kasa ve banka sekmesindeki “Kasaya işle” listesinden yazabilirsiniz."
            confirmLabel="Kasaya yazmadan işaretle"
            tone="default"
            onConfirm={() => collect(true)}
          />
        </>
      ) : (
        <span className="text-xs text-text-faint">
          Bekleyen kayıtları işaretleyip topluca tahsil edin
        </span>
      )}
    </div>
  );
}
