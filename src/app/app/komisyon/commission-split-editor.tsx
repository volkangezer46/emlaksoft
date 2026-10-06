"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Split, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/inline-dialog";
import { updateCommissionSplits } from "@/app/actions/commissions";
import { useAutoAnimate } from "@/components/ui/auto-animate";
import { AnimatedNumber } from "@/components/ui/animated-number";

/** `id`: yalnız istemci tarafı kararlı satır anahtarı (animasyon + odak korunur); sunucuya gitmez. */
type Row = { id: number; label: string; rate: string };

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export function CommissionSplitEditor({
  commissionId,
  gross,
  initial,
}: {
  commissionId: string;
  gross: number;
  initial: { label?: string; rate?: number }[] | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(
    initial && initial.length > 0
      ? initial.map((s, i) => ({ id: i, label: s.label ?? "", rate: String(s.rate ?? "") }))
      : [{ id: 0, label: "Danışman", rate: "60" }, { id: 1, label: "Ofis", rate: "40" }],
  );
  const nextId = useRef(Math.max(2, initial?.length ?? 0));
  // Pay satırı eklenince/silinince yumuşak geçiş.
  const rowsRef = useAutoAnimate<HTMLDivElement>();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalRate = rows.reduce((s, r) => s + (Number(r.rate) || 0), 0);
  const remaining = 100 - totalRate;

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    const id = nextId.current;
    nextId.current += 1;
    setRows((rs) => [...rs, { id, label: "", rate: "" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCommissionSplits(
        commissionId,
        rows.map((r) => ({ label: r.label, rate: Number(r.rate) || 0 })),
      );
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline px-2.5 py-1.5 text-xs font-bold text-text transition hover:border-border-interactive"
        >
          <Split className="h-3.5 w-3.5 text-accent-text" /> Paylaşım
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader
          icon={<Split />}
          title="Komisyon paylaşımı"
          description="Brüt komisyonu taraflar arasında bölüştürün."
        />
        <div className="p-6">
              <p className="mb-3 text-sm text-text-muted">Brüt komisyon: <span className="font-bold text-text">{money(gross)}</span></p>

              <div ref={rowsRef} className="space-y-2">
                {rows.map((r, i) => {
                  const amt = Math.round(gross * ((Number(r.rate) || 0) / 100));
                  return (
                    <div key={r.id} className="flex items-center gap-2">
                      <input
                        value={r.label}
                        onChange={(e) => update(i, { label: e.target.value })}
                        placeholder="Taraf (ör. Danışman, Ofis, Referans)"
                        className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
                      />
                      <div className="relative w-20 shrink-0">
                        <input
                          type="number" min="0" max="100" step="1"
                          value={r.rate}
                          onChange={(e) => update(i, { rate: e.target.value })}
                          placeholder="%"
                          className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-2 pr-6 text-sm outline-none focus:border-accent"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-faint">%</span>
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-text"><AnimatedNumber value={amt} kind="currency" /></span>
                      <button type="button" onClick={() => removeRow(i)} aria-label="Sil" className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-faint hover:bg-[color-mix(in_srgb,var(--viz-neg)_12%,transparent)] hover:text-[color:var(--viz-neg)]">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent-text hover:underline">
                <Plus className="h-3.5 w-3.5" /> Taraf ekle
              </button>

              <div className={`mt-3 flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold ${totalRate > 100 ? "bg-[color-mix(in_srgb,var(--viz-neg)_12%,transparent)] text-[color:var(--viz-neg)]" : remaining === 0 ? "bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)] text-[color:var(--viz-pos)]" : "bg-canvas text-text-muted"}`}>
                <span>Toplam: %{totalRate.toFixed(0)}</span>
                <span>{remaining >= 0 ? `Kalan: %${remaining.toFixed(0)}` : `%${Math.abs(remaining).toFixed(0)} fazla`}</span>
              </div>

              {error ? (
                <p className="mt-2 text-sm font-medium text-[color:var(--viz-neg)]" role="alert">{error}</p>
              ) : null}

              <div className="hairline-t mt-4 flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2 text-sm font-medium text-text transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="button" onClick={save} disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-brand-700 disabled:opacity-60">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Kaydet
                </button>
              </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
