"use client";

import { useActionState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, UserPlus } from "lucide-react";
import { applyForeignChecklist, markCustomerForeign, type ForeignSaleResult } from "@/app/actions/foreign-sale";

const EMPTY: ForeignSaleResult = {};

const inputCls =
  "w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/** Sonuç/hata şeridi — iki formda da aynı görünsün diye ortak. */
function Feedback({ state, okText }: { state: ForeignSaleResult; okText: string }) {
  if (state.error) {
    return <p className="rounded-[10px] bg-danger-500/10 px-3 py-2 text-xs font-semibold text-danger-600">{state.error}</p>;
  }
  if (state.ok) {
    return (
      <p className="flex items-center gap-1.5 rounded-[10px] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> {okText}
      </p>
    );
  }
  return null;
}

/**
 * "Bu anlaşmaya uygula" — yabancıya satış evrak listesini seçilen anlaşmaya
 * toplu ekler. Zaten ekli maddeler action tarafında atlanır.
 */
export function ApplyChecklistForm({
  deals,
  itemCount,
}: {
  deals: { id: string; label: string }[];
  itemCount: number;
}) {
  const [state, formAction, pending] = useActionState(applyForeignChecklist, EMPTY);

  if (deals.length === 0) {
    return (
      <p className="rounded-[12px] border border-dashed border-line-strong bg-canvas px-4 py-3 text-xs text-text-muted">
        Açık anlaşma yok. Anlaşma oluşturduğunuzda bu listeyi tek tıkla ona kopyalayabilirsiniz.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1 text-xs font-semibold text-text-muted">
          Anlaşma seç
          <select name="deal_id" required defaultValue="" className={`mt-1 ${inputCls}`}>
            <option value="" disabled>
              Anlaşma seçin…
            </option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
          {itemCount} maddeyi uygula
        </button>
      </div>
      <Feedback state={state} okText={`${state.added ?? 0} madde anlaşmanın evrak listesine eklendi.`} />
    </form>
  );
}

/**
 * "Yabancı olarak işaretle" — mevcut müşteriyi yabancı uyruklu yapar.
 * Uyruk ve pasaport opsiyoneldir; sonradan müşteri kartından tamamlanabilir.
 */
export function MarkForeignForm({ customers }: { customers: { id: string; full_name: string }[] }) {
  const [state, formAction, pending] = useActionState(markCustomerForeign, EMPTY);

  if (customers.length === 0) {
    return (
      <p className="rounded-[12px] border border-dashed border-line-strong bg-canvas px-4 py-3 text-xs text-text-muted">
        İşaretlenecek müşteri kalmadı — kayıtlı müşterilerin tamamı yabancı olarak işaretli.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
        <label className="text-xs font-semibold text-text-muted">
          Müşteri
          <select name="customer_id" required defaultValue="" className={`mt-1 ${inputCls}`}>
            <option value="" disabled>
              Müşteri seçin…
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Uyruk <span className="font-normal text-text-faint">(opsiyonel)</span>
          <input name="nationality" maxLength={80} placeholder="Almanya" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Pasaport no <span className="font-normal text-text-faint">(opsiyonel)</span>
          <input name="passport_no" maxLength={40} placeholder="C01X00000" className={`mt-1 ${inputCls}`} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          İşaretle
        </button>
      </div>
      <Feedback state={state} okText="Müşteri yabancı uyruklu olarak işaretlendi." />
    </form>
  );
}
