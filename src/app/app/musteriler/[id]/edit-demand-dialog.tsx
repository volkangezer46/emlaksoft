"use client";

import { useActionState, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateDemand, type DemandResult } from "@/app/actions/demands";

type Province = { id: string; name: string };

const initial: DemandResult = {};
const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

export function EditDemandDialog({
  demand,
  provinces,
  customerId,
}: {
  demand: {
    id: string;
    transaction_type: string;
    property_type: string | null;
    budget_min: number | null;
    budget_max: number | null;
    rooms: string | null;
    min_sqm: number | null;
    urgency: string | null;
    status: string;
    province_id: string | null;
  };
  provinces: Province[];
  customerId: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const [state, action, pending] = useActionState(async (prev: DemandResult, formData: FormData) => {
    const result = await updateDemand(prev, formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        router.refresh();
      });
    }
    return result;
  }, initial);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-semibold text-brand-600 hover:underline">
        <span className="inline-flex items-center gap-0.5"><Pencil className="h-3 w-3" /> Düzenle</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/45 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-xl rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">Talep düzenle</h2>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form action={action} className="grid gap-4 p-6 sm:grid-cols-2">
              <input type="hidden" name="id" value={demand.id} />
              <input type="hidden" name="customer_id" value={customerId} />
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">İşlem *</label>
                <select name="transaction_type" required defaultValue={demand.transaction_type} className={fieldClass}>
                  <option>Satılık</option>
                  <option>Kiralık</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">Tür</label>
                <select name="property_type" defaultValue={demand.property_type ?? "Daire"} className={fieldClass}>
                  {["Daire", "Villa", "Arsa", "İşyeri", "Müstakil ev", "Bina"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">Bütçe min</label>
                <input name="budget_min" defaultValue={demand.budget_min ?? ""} className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">Bütçe max</label>
                <input name="budget_max" defaultValue={demand.budget_max ?? ""} className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">Oda</label>
                <input name="rooms" defaultValue={demand.rooms ?? ""} className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">Min m²</label>
                <input name="min_sqm" defaultValue={demand.min_sqm ?? ""} className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">İl</label>
                <select name="province_id" defaultValue={demand.province_id ?? ""} className={fieldClass}>
                  <option value="">Seçiniz</option>
                  {provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted">Durum</label>
                <select name="status" defaultValue={demand.status} className={fieldClass}>
                  <option value="new">Yeni</option>
                  <option value="active">Aktif</option>
                  <option value="matched">Eşleşti</option>
                  <option value="closed">Kapalı</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted">Aciliyet</label>
                <select name="urgency" defaultValue={demand.urgency ?? "normal"} className={fieldClass}>
                  <option value="low">Düşük</option>
                  <option value="normal">Normal</option>
                  <option value="high">Yüksek</option>
                  <option value="urgent">Acil</option>
                </select>
              </div>
              {state.error ? <p className="sm:col-span-2 text-sm text-danger-500">{state.error}</p> : null}
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm">Vazgeç</button>
                <button type="submit" disabled={pending} className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  {pending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
