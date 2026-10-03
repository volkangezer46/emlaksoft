"use client";

import { Check, ChevronsUpDown, MapPin, Sparkles, TriangleAlert } from "lucide-react";
import { createAppointment } from "@/app/actions/appointments";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";

type Option = { id: string; label: string };

export function AppointmentForm({
  customers,
  properties,
  typeOptions,
  defaultCustomerId,
  defaultPropertyId,
  defaultDate,
  defaultTime,
}: {
  customers: Option[];
  properties: Option[];
  typeOptions: { value: string; label: string }[];
  /** ?customer= — müşteri kartından "Randevu ver" ön seçimi. */
  defaultCustomerId?: string;
  /** ?property= — eşleştirmeden "Randevu ver" ön seçimi. */
  defaultPropertyId?: string;
  /** Sunucudan gelen bugün (YYYY-MM-DD) ya da ?tarih= ön dolgusu. */
  defaultDate: string;
  /** ?saat= (HH:MM) ya da 10:00. */
  defaultTime: string;
}) {
  // Sunucu çakışma bulursa kayıt YAPILMAZ ve conflictWarning döner; form uyarı
  // bandı + gizli confirm_conflict=1 ile ikinci gönderimde kayıt geçer.
  const { state, onSubmit, pending } = useCreateForm((fd) => createAppointment(fd), {
    successMessage: "Randevu planlandı",
    redirectTo: () => "/app/randevular",
  });
  const conflictWarning = state.conflictWarning ?? null;
  const error = !conflictWarning && state.error ? state.error : null;

  return (
    <FormShell
      title="Yeni randevu planla"
      description="Yer gösterme, değerleme veya ofis görüşmesi ekleyin."
      breadcrumbs={[{ label: "Randevular", href: "/app/randevular" }, { label: "Yeni randevu" }]}
      cancelHref="/app/randevular"
      submitLabel={conflictWarning ? "Yine de kaydet" : "Randevuyu planla"}
      pendingLabel="Planlanıyor…"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      notice={
        conflictWarning ? (
          <div
            className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-xs font-medium leading-relaxed text-amber-700"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong>{conflictWarning}</strong> Randevu henüz kaydedilmedi — yine de planlamak
              istiyorsanız &quot;Yine de kaydet&quot; ile devam edin.
            </span>
            <input type="hidden" name="confirm_conflict" value="1" />
          </div>
        ) : null
      }
    >
      <FormSection title="Zaman" description="Randevunun türü, günü ve süresi.">
        {/* Kısa liste: yerel seçici kalır (mobilde OS seçicisi); görünümü Combobox tetikleyicisiyle aynı. */}
        <FormField label="Randevu türü" htmlFor="appointment-type" required inject={false}>
          <div className="relative">
            <FormSelect
              id="appointment-type"
              name="appointment_type"
              required
              aria-required="true"
              defaultValue="showing"
              className="focus-ring cursor-pointer appearance-none pr-9 hover:border-brand-300"
            >
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </FormSelect>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          </div>
        </FormField>
        <FormField label="Süre (dk)" htmlFor="appointment-duration">
          <FormInput name="duration_min" inputMode="numeric" placeholder="45" />
        </FormField>
        <FormField label="Tarih" htmlFor="appointment-date" required>
          <FormInput name="date" type="date" required defaultValue={defaultDate} />
        </FormField>
        <FormField label="Saat" htmlFor="appointment-time" required>
          <FormInput name="time" type="time" required defaultValue={defaultTime} />
        </FormField>
      </FormSection>

      <FormSection title="Katılımcılar ve yer" description="Müşteri ve portföy yazarak aranır (Türkçe karakter duyarsız).">
        <FormField label="Müşteri" htmlFor="appointment-customer">
          <Combobox
            name="customer_id"
            aria-label="Müşteri"
            placeholder="Seçiniz"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            defaultValue={defaultCustomerId}
            options={customers.map((c) => ({ value: c.id, label: c.label }))}
          />
        </FormField>
        <FormField label="Portföy" htmlFor="appointment-property">
          <Combobox
            name="property_id"
            aria-label="Portföy"
            placeholder="Seçiniz"
            searchPlaceholder="Portföy ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            defaultValue={defaultPropertyId}
            options={properties.map((p) => ({ value: p.id, label: p.label }))}
          />
        </FormField>
        <FormField label="Konum" htmlFor="appointment-location" inject={false} className="sm:col-span-2">
          <div className="relative">
            <FormInput id="appointment-location" name="location" className="pr-9" placeholder="Onikişubat, Kahramanmaraş" />
            <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          </div>
        </FormField>
        <FormField label="Not" htmlFor="appointment-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Talep, hazırlık, dikkat edilecekler…" />
        </FormField>
      </FormSection>

      <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/5 px-4 py-3 text-xs font-semibold text-brand-600">
        <Sparkles className="h-4 w-4 shrink-0" /> Randevu “teyit bekliyor” olarak açılır; onaylayıp tamamlandığında komisyon akışına kaynak olur.
      </p>
    </FormShell>
  );
}
