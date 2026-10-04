"use client";

import { useActionState, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarHeart, MapPin, Pencil, UserCog, UserRound } from "lucide-react";
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
  branches = [],
  advisors = [],
  sources = [],
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
    branch_id?: string | null;
    assigned_to?: string | null;
    source?: string | null;
    lead_source_detail?: string | null;
    blacklist?: boolean;
  };
  provinces: Province[];
  types?: string[];
  branches?: { id: string; name: string }[];
  advisors?: { id: string; full_name: string }[];
  sources?: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const currentTypes = customer.customer_types && customer.customer_types.length > 0 ? customer.customer_types : ["Alıcı"];
  // Mevcut türler tanım listesinde yoksa da seçili görünür (veri kaybı olmaz)
  const typeOptions = [...new Set([...types, ...currentTypes])];

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
      fieldLabels={{ branch_id: "Şube", assigned_to: "Danışman", source: "Kaynak", lead_source_detail: "Kaynak detayı", full_name: "Ad soyad", phone: "Telefon", email: "E-posta", type: "Tür", birth_date: "Doğum tarihi", anniversary_date: "Yıldönümü", anniversary_note: "Yıldönümü notu", notes: "Not" }}
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
        { id: "kayit", label: "Kayıt ve atama", icon: UserCog, fields: ["branch_id", "assigned_to", "source", "lead_source_detail"] },
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
            <fieldset className="sm:col-span-2">
              <legend className={lbl}>Müşteri türü (birden fazla seçilebilir)</legend>
              <div className="flex flex-wrap gap-2">
                {typeOptions.map((t) => (
                  <label key={t} className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm">
                    <input type="checkbox" name="type" value={t} defaultChecked={currentTypes.includes(t)} className="h-4 w-4 accent-brand-600" />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
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
        kayit: (
          <>
            <input type="hidden" name="blacklist_present" value="1" />
            {branches.length > 0 ? (
              <div>
                <label className={lbl} htmlFor="edit-branch">Şube</label>
                <select id="edit-branch" name="branch_id" defaultValue={customer.branch_id ?? ""} className={input}>
                  <option value="">Şube atanmadı</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            ) : null}
            {advisors.length > 0 ? (
              <div>
                <label className={lbl} htmlFor="edit-assigned">Danışman</label>
                <select id="edit-assigned" name="assigned_to" defaultValue={customer.assigned_to ?? ""} className={input}>
                  <option value="">Danışmansız</option>
                  {advisors.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </select>
              </div>
            ) : null}
            <div>
              <label className={lbl} htmlFor="edit-source">Kaynak</label>
              <select id="edit-source" name="source" defaultValue={customer.source ?? ""} className={input}>
                <option value="">Belirtilmedi</option>
                {customer.source && !sources.some((x) => x.value === customer.source) ? <option value={customer.source}>{customer.source}</option> : null}
                {sources.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="edit-source-detail">Kaynak detayı</label>
              <input id="edit-source-detail" name="lead_source_detail" defaultValue={customer.lead_source_detail ?? ""} placeholder="Örn. tavsiye eden kişi, ilan numarası" className={input} />
            </div>
            <label className="inline-flex cursor-pointer items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="blacklist" defaultChecked={customer.blacklist} className="mt-0.5 h-4 w-4 accent-danger-500" />
              <span>
                <span className="font-semibold text-ink-950">Kara liste</span>
                <span className="block text-xs text-text-muted">İşaretli müşteriye kampanya gönderilmez ve eylem önerilmez.</span>
              </span>
            </label>
          </>
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
