"use client";

import { useActionState, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Wallet } from "lucide-react";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { GeoSelect } from "@/components/app/geo-select";
import { updateDemand, type DemandResult } from "@/app/actions/demands";
import { defaultDefinitionValues } from "@/lib/definition-defaults";

type Province = { id: string; name: string };

const initial: DemandResult = {};
const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

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

  const lbl = "mb-1.5 block text-sm text-text-muted";
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Talep düzenle"
      icon={<Pencil />}
      action={action}
      pending={pending}
      error={state.error}
      hiddenFields={
        <>
          <input type="hidden" name="id" value={demand.id} />
          <input type="hidden" name="customer_id" value={customerId} />
        </>
      }
      fieldLabels={{ transaction_type: "İşlem", property_type: "Tür", budget_min: "Bütçe min", budget_max: "Bütçe max", rooms: "Oda", min_sqm: "Min m²", status: "Durum", urgency: "Aciliyet" }}
      trigger={({ onClick, ...aria }) => (
        <button type="button" onClick={onClick} {...aria} className="focus-ring rounded-[var(--radius-control)] text-xs font-semibold text-brand-700 hover:underline">
          <span className="inline-flex items-center gap-0.5"><Pencil className="h-3 w-3" /> Düzenle</span>
        </button>
      )}
      tabs={[
        { id: "kriter", label: "Kriterler", icon: Wallet, fields: ["transaction_type", "property_type", "budget_min", "budget_max", "rooms", "min_sqm"] },
        { id: "bolge", label: "Bölge", icon: MapPin, fields: [] },
        { id: "durum", label: "Durum", icon: Pencil, fields: ["status", "urgency"] },
      ]}
      panels={{
        kriter: (
          <>
            <div>
              <label className={lbl} htmlFor="ed-transaction">İşlem *</label>
              <select id="ed-transaction" name="transaction_type" required defaultValue={demand.transaction_type} className={fieldClass}>
                <option>Satılık</option>
                <option>Kiralık</option>
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="ed-ptype">Tür</label>
              <select id="ed-ptype" name="property_type" defaultValue={demand.property_type ?? "Daire"} className={fieldClass}>
                {defaultDefinitionValues("property_type").map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="ed-bmin">Bütçe min</label>
              <input id="ed-bmin" name="budget_min" defaultValue={demand.budget_min ?? ""} className={fieldClass} />
            </div>
            <div>
              <label className={lbl} htmlFor="ed-bmax">Bütçe max</label>
              <input id="ed-bmax" name="budget_max" defaultValue={demand.budget_max ?? ""} className={fieldClass} />
            </div>
            <div>
              <label className={lbl} htmlFor="ed-rooms">Oda</label>
              <input id="ed-rooms" name="rooms" defaultValue={demand.rooms ?? ""} className={fieldClass} />
            </div>
            <div>
              <label className={lbl} htmlFor="ed-sqm">Min m²</label>
              <input id="ed-sqm" name="min_sqm" defaultValue={demand.min_sqm ?? ""} className={fieldClass} />
            </div>
          </>
        ),
        bolge: (
          <div className="sm:col-span-2">
            <GeoSelect
              provinces={provinces}
              defaultProvinceId={demand.province_id}
              defaultDistrictId={demand.district_id}
              defaultNeighborhoodId={demand.neighborhood_id}
            />
          </div>
        ),
        durum: (
          <>
            <div>
              <label className={lbl} htmlFor="ed-status">Durum</label>
              <select id="ed-status" name="status" defaultValue={demand.status} className={fieldClass}>
                <option value="new">Yeni</option>
                <option value="active">Aktif</option>
                <option value="matched">Eşleşti</option>
                <option value="closed">Kapalı</option>
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="ed-urgency">Aciliyet</label>
              <select id="ed-urgency" name="urgency" defaultValue={demand.urgency ?? "normal"} className={fieldClass}>
                <option value="low">Düşük</option>
                <option value="normal">Normal</option>
                <option value="high">Yüksek</option>
                <option value="urgent">Acil</option>
              </select>
            </div>
          </>
        ),
      }}
    />
  );
}
