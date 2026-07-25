"use client";

import { useActionState, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GeoSelect } from "@/components/app/geo-select";
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
    district_id: string | null;
    neighborhood_id: string | null;
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
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="focus-ring rounded-[6px] text-[11px] font-semibold text-brand-700 hover:underline">
          <span className="inline-flex items-center gap-0.5"><Pencil className="h-3 w-3" /> Düzenle</span>
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader icon={<Pencil />} title="Talep düzenle" />
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
              <div className="sm:col-span-2">
                <GeoSelect
                  provinces={provinces}
                  defaultProvinceId={demand.province_id}
                  defaultDistrictId={demand.district_id}
                  defaultNeighborhoodId={demand.neighborhood_id}
                />
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
              {state.error ? (
                <p className="sm:col-span-2 text-sm font-medium text-danger-600" role="alert">{state.error}</p>
              ) : null}
              <div className="hairline-t sm:col-span-2 flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="submit" disabled={pending} className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  {pending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
