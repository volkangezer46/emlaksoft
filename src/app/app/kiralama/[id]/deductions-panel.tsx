"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Receipt, Trash2, Wand2 } from "lucide-react";
import { addDepositDeduction, deleteDepositDeduction } from "@/app/actions/rental-inspections";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { formatTry } from "@/lib/format";
import type { DepositSummary } from "@/lib/rentals/inspection";

type Suggestion = { itemKey: string; label: string; before: string | null; after: string; note: string };

/**
 * Kalemli depozito kesintisi (SP6). Tahliye tutanağında kötüleşen kalemler öneri olarak gelir; tutarı kullanıcı yazar
 * (fiyat uydurulmaz). Toplam kesinti depozitoyu aşamaz; iade edildikten sonra kilitlidir (DB kapısı da aynı).
 * İade hareketi hesaba NET tutarla (depozito − kesintiler) yazılır.
 */
export function DeductionsPanel({
  rentalId,
  moveOutId,
  deductions,
  suggestions,
  summary,
  locked,
  canEdit,
}: {
  rentalId: string;
  moveOutId: string | null;
  deductions: { id: string; label: string; amount: number }[];
  suggestions: Suggestion[];
  summary: DepositSummary;
  locked: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [itemKey, setItemKey] = useState<string | null>(null);
  const editable = canEdit && !locked;

  const add = () =>
    start(async () => {
      const res = await addDepositDeduction({ rentalId, label, amount, inspectionId: itemKey ? moveOutId : null, itemKey });
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push("Kesinti eklendi", "ok");
      setLabel("");
      setAmount("");
      setItemKey(null);
      router.refresh();
    });

  const remove = async (id: string) => {
    const res = await deleteDepositDeduction(id);
    if (res.error) push(res.error, "err");
    else {
      push("Kesinti silindi", "ok");
      router.refresh();
    }
  };

  return (
    <section aria-labelledby="deductions-title" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="deductions-title" className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Receipt className="h-4 w-4 text-brand-600" aria-hidden="true" /> Depozito kesintileri
        </h3>
        {locked ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Depozito iade edildi; kesintiler kilitli
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-[var(--radius-card)] bg-canvas px-3 py-2">
          <dt className="text-xs text-text-muted">Depozito</dt>
          <dd className="numeric font-semibold text-ink-950">{formatTry(summary.deposit)}</dd>
        </div>
        <div className="rounded-[var(--radius-card)] bg-canvas px-3 py-2">
          <dt className="text-xs text-text-muted">Kesinti</dt>
          <dd className={`numeric font-semibold ${summary.deducted > 0 ? "text-danger-600" : "text-ink-950"}`}>{formatTry(summary.deducted)}</dd>
        </div>
        <div className="rounded-[var(--radius-card)] bg-mint-500/8 px-3 py-2">
          <dt className="text-xs text-text-muted">İade edilecek</dt>
          <dd className="numeric font-bold text-mint-700">{formatTry(summary.net)}</dd>
        </div>
      </dl>

      {deductions.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {deductions.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 text-ink-950">{d.label}</span>
              <span className="numeric shrink-0 font-semibold text-ink-950">{formatTry(d.amount)}</span>
              {editable ? (
                <ConfirmDialog
                  trigger={<Button variant="ghost" size="icon" icon={Trash2} aria-label={`${d.label} kesintisini sil`} />}
                  title="Kesintiyi sil"
                  description={`${d.label} (${formatTry(d.amount)}) kesintisi silinecek; iade edilecek tutar artar.`}
                  confirmLabel="Sil"
                  onConfirm={() => remove(d.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-text-muted">Kesinti yok: depozitonun tamamı iade edilir.</p>
      )}

      {editable && suggestions.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Tahliye tutanağından öneriler
          </p>
          <ul className="mt-2 space-y-2">
            {suggestions.map((s) => (
              <li key={s.itemKey} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/8 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink-950">{s.label}</span>
                  <span className="block text-xs text-text-muted">
                    {s.before ? `Teslimde ${s.before.toLocaleLowerCase("tr-TR")} → tahliyede ${s.after.toLocaleLowerCase("tr-TR")}` : `Tahliyede ${s.after.toLocaleLowerCase("tr-TR")} (teslim kaydı yok)`}
                    {s.note ? ` · ${s.note}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  icon={Plus}
                  onClick={() => {
                    setLabel(s.label);
                    setItemKey(s.itemKey);
                    document.getElementById("ded-amount")?.focus();
                  }}
                >
                  Kesinti yaz
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editable ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
          <FormField label="Kesinti açıklaması" htmlFor="ded-label">
            <FormInput value={label} maxLength={200} placeholder="Örn. Salon boyası" onChange={(e) => { setLabel(e.target.value); setItemKey(null); }} />
          </FormField>
          <FormField label="Tutar (TL)" htmlFor="ded-amount">
            <FormInput value={amount} inputMode="decimal" placeholder="Örn. 3.500" onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <Button icon={Plus} loading={pending} disabled={label.trim().length < 2 || !amount.trim()} onClick={add}>
            Ekle
          </Button>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-muted">
        Kesinti tutarı depozito hesabında kalır; onarım masrafını “Masraf ekle” ile bu mülke işleyin. Tahliye tutanağının imza metni kesintileri içerir.
      </p>
    </section>
  );
}
