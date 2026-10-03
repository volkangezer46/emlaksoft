"use client";

import { useActionState, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarHeart, MapPin, Pencil, UserRound } from "lucide-react";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { GeoSelect } from "@/components/app/geo-select";
import { updateCustomer, type CustomerResult } from "@/app/actions/customers";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";

type Province = { id: string; name: string };

const initial: CustomerResult = {};
const DEFAULT_TYPES = ["Alıcı", "Mülk sahibi", "Kiracı", "Yatırımcı"];

export function EditCustomerDialog({
  customer,
  provinces,
  types = DEFAULT_TYPES,
}: {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    customer_types: string[] | null;
    province_id: string | null;
    district_id: string | null;
    notes: string | null;
    birth_date: string | null;
    anniversary_date: string | null;
    anniversary_note: string | null;
  };
  provinces: Province[];
  types?: string[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const defaultType = customer.customer_types?.[0] ?? "Alıcı";

  const [state, action, pending] = useActionState(async (prev: CustomerResult, formData: FormData) => {
    const result = await updateCustomer(prev, formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        router.refresh();
      });
    }
    return result;
  }, initial);

  const input =
    "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";
  const lbl = "mb-1.5 block text-sm text-text-muted";
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Müşteri düzenle"
      description={customer.full_name}
      icon={<Pencil />}
      action={action}
      pending={pending}
      error={state.error}
      hiddenFields={<input type="hidden" name="id" value={customer.id} />}
      fieldLabels={{ full_name: "Ad soyad", phone: "Telefon", email: "E-posta", type: "Tür", birth_date: "Doğum tarihi", anniversary_date: "Yıldönümü", anniversary_note: "Yıldönümü notu", notes: "Not" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <Pencil className="h-4 w-4" /> Düzenle
        </button>
      )}
      tabs={[
        { id: "kimlik", label: "Kimlik ve iletişim", icon: UserRound, fields: ["full_name", "phone", "email", "type"] },
        { id: "konum", label: "Bölge", icon: MapPin, fields: [] },
        { id: "ozel", label: "Özel günler ve not", icon: CalendarHeart, fields: ["birth_date", "anniversary_date", "anniversary_note", "notes"] },
      ]}
      panels={{
        kimlik: (
          <>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="edit-full-name">Ad soyad *</label>
              <input id="edit-full-name" name="full_name" required defaultValue={customer.full_name} className={input} />
            </div>
            <div>
              <label className={lbl} htmlFor="edit-phone">Telefon</label>
              <PhoneInput id="edit-phone" name="phone" defaultValue={customer.phone} />
            </div>
            <div>
              <label className={lbl} htmlFor="edit-email">E-posta</label>
              <EmailInput id="edit-email" name="email" defaultValue={customer.email ?? ""} className={input} />
            </div>
            <div>
              <label className={lbl} htmlFor="edit-type">Tür</label>
              <select id="edit-type" name="type" defaultValue={defaultType} className={input}>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </>
        ),
        konum: (
          <div className="sm:col-span-2">
            <GeoSelect
              provinces={provinces}
              withNeighborhood={false}
              defaultProvinceId={customer.province_id}
              defaultDistrictId={customer.district_id}
            />
          </div>
        ),
        ozel: (
          <>
            <div>
              <label className={lbl} htmlFor="edit-birth-date">Doğum tarihi</label>
              <input id="edit-birth-date" name="birth_date" type="date" max="2100-12-31" defaultValue={customer.birth_date ?? ""} className={input} />
            </div>
            <div>
              <label className={lbl} htmlFor="edit-anniversary-date">Yıldönümü</label>
              <input id="edit-anniversary-date" name="anniversary_date" type="date" max="2100-12-31" defaultValue={customer.anniversary_date ?? ""} className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="edit-anniversary-note">Yıldönümü notu</label>
              <input id="edit-anniversary-note" name="anniversary_note" defaultValue={customer.anniversary_note ?? ""} placeholder="Örn. İlk ev alımı, 3 yıllık kiracı" className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor="edit-notes">Not</label>
              <textarea id="edit-notes" name="notes" rows={3} defaultValue={customer.notes ?? ""} className={`${input} resize-none`} />
            </div>
          </>
        ),
      }}
    />
  );
}
