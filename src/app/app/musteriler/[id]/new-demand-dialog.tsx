"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, X } from "lucide-react";
import { createDemand, type DemandResult } from "@/app/actions/demands";

type Province = { id: string; name: string };

const initial: DemandResult = {};

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export function NewDemandDialog({
  customerId,
  customerName,
  provinces,
  defaultProvinceId,
}: {
  customerId: string;
  customerName: string;
  provinces: Province[];
  defaultProvinceId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (prev: DemandResult, formData: FormData) => {
    const result = await createDemand(prev, formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        formRef.current?.reset();
        router.refresh();
      });
    }
    return result;
  }, initial);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
      >
        <Plus className="h-3.5 w-3.5" /> Talep ekle
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/45 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-xl overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] px-6 py-5 text-white">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-mint-400">
                    <Target className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Yeni talep</h2>
                    <p className="text-xs text-white/55">{customerName}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 text-white/70 transition hover:bg-white/15"
                  aria-label="Kapat"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form ref={formRef} action={action} className="grid gap-4 p-6 sm:grid-cols-2">
              <input type="hidden" name="customer_id" value={customerId} />
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-tx">İşlem türü *</label>
                <select id="demand-tx" name="transaction_type" required defaultValue="Satılık" className={fieldClass}>
                  <option>Satılık</option>
                  <option>Kiralık</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-type">Portföy türü</label>
                <select id="demand-type" name="property_type" defaultValue="Daire" className={fieldClass}>
                  {["Daire", "Villa", "Arsa", "İşyeri", "Müstakil ev", "Bina"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-budget-min">Bütçe min</label>
                <input id="demand-budget-min" name="budget_min" inputMode="decimal" className={fieldClass} placeholder="5.000.000" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-budget-max">Bütçe max</label>
                <input id="demand-budget-max" name="budget_max" inputMode="decimal" className={fieldClass} placeholder="7.500.000" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-rooms">Oda</label>
                <input id="demand-rooms" name="rooms" className={fieldClass} placeholder="3+1" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-sqm">Min m²</label>
                <input id="demand-sqm" name="min_sqm" inputMode="decimal" className={fieldClass} placeholder="120" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-province">İl</label>
                <select
                  id="demand-province"
                  name="province_id"
                  defaultValue={defaultProvinceId ?? ""}
                  className={fieldClass}
                >
                  <option value="">Seçiniz</option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-urgency">Aciliyet</label>
                <select id="demand-urgency" name="urgency" defaultValue="normal" className={fieldClass}>
                  <option value="low">Düşük</option>
                  <option value="normal">Normal</option>
                  <option value="high">Yüksek</option>
                  <option value="urgent">Acil</option>
                </select>
              </div>

              {state.error ? (
                <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{state.error}</p>
              ) : null}

              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium">
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {pending ? "Kaydediliyor…" : "Talebi kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
