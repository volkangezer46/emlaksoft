"use client";

import { useActionState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, FolderOpen, Plus, Trash2 } from "lucide-react";
import {
  addDealCost,
  deleteDealCost,
  toggleDealCostPaid,
  type DealCost,
  type DealCostKind,
  type DealResult,
} from "@/app/actions/deals";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Tür etiketleri + rozet stilleri — migration'daki check listesiyle birebir. */
const KIND_META: Record<DealCostKind, { label: string; badge: string }> = {
  kapora: { label: "Kapora", badge: "bg-mint-500/10 text-mint-700 ring-mint-600/20" },
  tapu_harci: { label: "Tapu harcı", badge: "bg-brand-50 text-brand-700 ring-brand-600/20" },
  ekspertiz: { label: "Ekspertiz", badge: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  komisyon_dis: { label: "Dış komisyon", badge: "bg-cyan-50 text-cyan-700 ring-cyan-600/20" },
  diger: { label: "Diğer", badge: "bg-zinc-100 text-zinc-600 ring-zinc-500/10" },
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/**
 * İşlem dosyası — anlaşma kapanış sürecindeki paranın kaydı.
 *
 * Kapora AYRI toplanır (alınan para), diğer türler masraftır (çıkan para);
 * net = kapora − masraf toplamı. Ödendi durumu satırdaki rozetle toggle edilir.
 */
export function DealCostsSection({
  dealId,
  costs,
  canEdit,
}: {
  dealId: string;
  costs: DealCost[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [togglePending, startToggle] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<DealResult, FormData>(
    async (prev, formData) => {
      const result = await addDealCost(prev, formData);
      if (result.ok) {
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    {},
  );

  const kapora = costs
    .filter((c) => c.kind === "kapora")
    .reduce((s, c) => s + Number(c.amount), 0);
  const masraf = costs
    .filter((c) => c.kind !== "kapora")
    .reduce((s, c) => s + Number(c.amount), 0);
  const net = kapora - masraf;

  function togglePaid(costId: string) {
    startToggle(async () => {
      await toggleDealCostPaid(costId, dealId);
      router.refresh();
    });
  }

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <FolderOpen className="h-4 w-4 text-brand-600" /> İşlem dosyası
      </h2>
      <p className="mt-1 text-[11px] text-text-faint">
        Kapora ve kapanış masrafları — tapu harcı, ekspertiz, dışarıya ödenen komisyon vb.
      </p>

      {/* Toplamlar */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          ["Kapora", money(kapora)],
          ["Masraf toplamı", money(masraf)],
          ["Net (kapora − masraf)", money(net)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
            <p className="text-[11px] text-text-faint">{k}</p>
            <p className={`numeric text-sm font-bold ${k.startsWith("Net") && net < 0 ? "text-danger-600" : "text-ink-950"}`}>{v}</p>
          </div>
        ))}
      </div>

      {/* Kalem listesi */}
      {costs.length === 0 ? (
        <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz kalem eklenmemiş.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {costs.map((c) => {
            const meta = KIND_META[c.kind] ?? KIND_META.diger;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta.badge}`}>
                    {meta.label}
                  </span>
                  {c.label ? (
                    <span className="truncate text-sm font-medium text-ink-950">{c.label}</span>
                  ) : null}
                  <span className="numeric text-sm font-bold text-ink-950">{money(Number(c.amount))}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={togglePending}
                      onClick={() => togglePaid(c.id)}
                      title={c.paid ? "Ödenmedi olarak işaretle" : "Ödendi olarak işaretle"}
                      className={`focus-ring press inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition disabled:opacity-60 ${
                        c.paid
                          ? "bg-mint-500/10 text-mint-700 ring-mint-600/20"
                          : "bg-zinc-100 text-zinc-600 ring-zinc-500/10 hover:bg-zinc-200"
                      }`}
                    >
                      {c.paid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                      {c.paid ? "Ödendi" : "Ödenmedi"}
                    </button>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                        c.paid
                          ? "bg-mint-500/10 text-mint-700 ring-mint-600/20"
                          : "bg-zinc-100 text-zinc-600 ring-zinc-500/10"
                      }`}
                    >
                      {c.paid ? "Ödendi" : "Ödenmedi"}
                    </span>
                  )}
                  {canEdit ? (
                    <ConfirmDialog
                      title="Kalemi sil"
                      description={`${meta.label}${c.label ? ` · ${c.label}` : ""} (${money(Number(c.amount))}) kalemi silinecek. Bu işlem geri alınamaz.`}
                      confirmLabel="Sil"
                      formAction={deleteDealCost}
                      hiddenFields={{ cost_id: c.id, deal_id: dealId }}
                      trigger={
                        <button
                          type="button"
                          aria-label="Kalemi sil"
                          className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Ekleme formu */}
      {canEdit ? (
        <form ref={formRef} action={action} className="hairline-t mt-4 grid gap-3 pt-4 sm:grid-cols-[160px_1fr_150px_auto]">
          <input type="hidden" name="deal_id" value={dealId} />
          <label className="text-xs font-semibold text-text-muted">
            Tür
            <select
              name="kind"
              required
              defaultValue="kapora"
              className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            >
              {(Object.keys(KIND_META) as DealCostKind[]).map((k) => (
                <option key={k} value={k}>{KIND_META[k].label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-text-muted">
            Etiket
            <input
              name="label"
              type="text"
              placeholder="Örn. tapu randevusu harcı (opsiyonel)"
              className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <label className="text-xs font-semibold text-text-muted">
            Tutar (₺)
            <input
              name="amount"
              type="number"
              min="0"
              step="100"
              required
              placeholder="Tutar"
              className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending}
              className="btn-shine focus-ring press inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> {pending ? "Ekleniyor…" : "Ekle"}
            </button>
          </div>
          {state.error ? (
            <p className="text-xs font-semibold text-danger-600 sm:col-span-4" role="alert">{state.error}</p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
