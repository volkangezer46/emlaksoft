"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target } from "lucide-react";
import { createDemand, type DemandResult } from "@/app/actions/demands";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GeoSelect } from "@/components/app/geo-select";

type Province = { id: string; name: string };

const initial: DemandResult = {};

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

const DEFAULT_TRANSACTION_TYPES = ["Satılık", "Kiralık"];
const DEFAULT_PROPERTY_TYPES = ["Daire", "Villa", "Arsa", "İşyeri", "Müstakil ev", "Bina"];
const DEFAULT_URGENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Yüksek" },
  { value: "urgent", label: "Acil" },
];

export function NewDemandDialog({
  customerId,
  customerName,
  provinces,
  defaultProvinceId,
  transactionTypes = DEFAULT_TRANSACTION_TYPES,
  propertyTypes = DEFAULT_PROPERTY_TYPES,
  urgencyOptions = DEFAULT_URGENCY_OPTIONS,
}: {
  customerId: string;
  customerName: string;
  provinces: Province[];
  defaultProvinceId?: string | null;
  transactionTypes?: string[];
  propertyTypes?: string[];
  urgencyOptions?: { value: string; label: string }[];
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
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" /> Talep ekle
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader icon={<Target />} title="Yeni talep" description={customerName} />
        <form ref={formRef} action={action} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
              <input type="hidden" name="customer_id" value={customerId} />
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-tx">İşlem türü *</label>
                <select id="demand-tx" name="transaction_type" required defaultValue="Satılık" className={fieldClass}>
                  {transactionTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-type">Portföy türü</label>
                <select id="demand-type" name="property_type" defaultValue="Daire" className={fieldClass}>
                  {propertyTypes.map((t) => (
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
              {/* Talebin de ilcesi olmali: eslestirme motoru portfoy ilcesi ile
                  talep ilcesini karsilastiriyor. Yalnizca il varken tum il
                  tek bir kova gibi davraniyordu. */}
              <div className="sm:col-span-2">
                <GeoSelect provinces={provinces} defaultProvinceId={defaultProvinceId} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="demand-urgency">Aciliyet</label>
                <select id="demand-urgency" name="urgency" defaultValue="normal" className={fieldClass}>
                  {urgencyOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {state.error ? (
                <p className="sm:col-span-2 text-sm font-medium text-danger-600" role="alert">{state.error}</p>
              ) : null}

              <div className="hairline-t sm:col-span-2 flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  disabled={pending}
                  className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {pending ? "Kaydediliyor…" : "Talebi kaydet"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
