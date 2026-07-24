"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  MapPin,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { createAppointment } from "@/app/actions/appointments";

type Option = { id: string; label: string };

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

const DEFAULT_TYPE_OPTIONS = [
  { value: "showing", label: "Yer gösterme" },
  { value: "office", label: "Ofis görüşmesi" },
  { value: "valuation", label: "Değerleme" },
  { value: "contract", label: "Sözleşme" },
];

export function NewAppointmentDialog({
  customers,
  properties,
  typeOptions = DEFAULT_TYPE_OPTIONS,
}: {
  customers: Option[];
  properties: Option[];
  typeOptions?: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createAppointment(formData);
    setPending(false);
    if (result.ok) {
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
      return;
    }
    setError(result.error ?? "Randevu oluşturulamadı.");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--shadow-sm)]"
      >
        <Plus className="h-4 w-4" /> Yeni randevu
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/55 p-4 backdrop-blur-md sm:items-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-white/20 bg-surface shadow-[var(--shadow-lg)]">
            <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] px-6 py-5 text-white">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-mint-400"><CalendarPlus className="h-5 w-5" /></span>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Yeni randevu planla</h2>
                    <p className="text-xs text-white/55">Yer gösterme, değerleme veya ofis görüşmesi ekleyin.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 text-white/70 transition hover:bg-white/15 hover:text-white" aria-label="Kapat">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form ref={formRef} action={submit} className="grid gap-4 p-6 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-type">Randevu türü *</label>
                <div className="relative">
                  <select id="appointment-type" name="appointment_type" required defaultValue="showing" className={`${fieldClass} appearance-none`}>
                    {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-duration">Süre (dk)</label>
                <input id="appointment-duration" name="duration_min" inputMode="numeric" className={fieldClass} placeholder="45" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-date">Tarih *</label>
                <input id="appointment-date" name="date" type="date" required defaultValue={today} className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-time">Saat *</label>
                <input id="appointment-time" name="time" type="time" required defaultValue="10:00" className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-customer">Müşteri</label>
                <div className="relative">
                  <select id="appointment-customer" name="customer_id" defaultValue="" className={`${fieldClass} appearance-none`}>
                    <option value="">Seçiniz</option>
                    {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-property">Portföy</label>
                <div className="relative">
                  <select id="appointment-property" name="property_id" defaultValue="" className={`${fieldClass} appearance-none`}>
                    <option value="">Seçiniz</option>
                    {properties.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-location">Konum</label>
                <div className="relative">
                  <input id="appointment-location" name="location" className={`${fieldClass} pr-9`} placeholder="Onikişubat, Kahramanmaraş" />
                  <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="appointment-notes">Not</label>
                <textarea id="appointment-notes" name="notes" rows={2} className={`${fieldClass} resize-none`} placeholder="Talep, hazırlık, dikkat edilecekler…" />
              </div>

              <div className="sm:col-span-2 rounded-[12px] border border-brand-300/40 bg-brand-600/5 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Sparkles className="h-4 w-4" /> Randevu “teyit bekliyor” olarak açılır; onaylayıp tamamlandığında komisyon akışına kaynak olur.</p>
              </div>

              {error ? <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{error}</p> : null}

              <div className="sm:col-span-2 flex items-center justify-end gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">Vazgeç</button>
                <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" /> {pending ? "Planlanıyor…" : "Randevuyu planla"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
