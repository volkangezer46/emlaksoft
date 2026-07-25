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
} from "lucide-react";
import { createAppointment } from "@/app/actions/appointments";
import { Combobox } from "@/components/ui/combobox";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--elev-2)]"
        >
          <Plus className="h-4 w-4" /> Yeni randevu
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader
          icon={<CalendarPlus />}
          title="Yeni randevu planla"
          description="Yer gösterme, değerleme veya ofis görüşmesi ekleyin."
        />
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
              {/* Müşteri ve portföy listeleri kayıt sayısıyla büyüyor; native
                  <select> içinde yüzlerce kayıt arasında yalnızca ilk harfe
                  atlanabiliyordu. Combobox yazarak arıyor (Türkçe karakter
                  duyarsız) ve `name` ile aynı FormData alanını gönderiyor. */}
              <div>
                <span className="mb-1.5 block text-sm font-medium text-ink-950">Müşteri</span>
                <Combobox
                  name="customer_id"
                  aria-label="Müşteri"
                  placeholder="Seçiniz"
                  searchPlaceholder="Müşteri ara…"
                  emptyText="Eşleşen müşteri yok"
                  onSearch={searchCustomers}
                  options={customers.map((customer) => ({ value: customer.id, label: customer.label }))}
                />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-medium text-ink-950">Portföy</span>
                <Combobox
                  name="property_id"
                  aria-label="Portföy"
                  placeholder="Seçiniz"
                  searchPlaceholder="Portföy ara…"
                  emptyText="Eşleşen portföy yok"
                  onSearch={searchProperties}
                  options={properties.map((property) => ({ value: property.id, label: property.label }))}
                />
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

              {error ? <p className="sm:col-span-2 text-sm font-medium text-danger-600" role="alert">{error}</p> : null}

              <div className="hairline-t sm:col-span-2 flex items-center justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="submit" disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" /> {pending ? "Planlanıyor…" : "Randevuyu planla"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
