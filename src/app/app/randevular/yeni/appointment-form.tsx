"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Sparkles, TriangleAlert } from "lucide-react";
import { createAppointment, type AppointmentResult } from "@/app/actions/appointments";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { FormField, Input, Textarea } from "@/components/ui/input";

type Option = { id: string; label: string };

const selectClass =
  "surface-sunken w-full rounded-[var(--radius-control)] border border-hairline px-3.5 py-2.5 text-sm text-ink-950 transition focus:border-brand-400 focus:bg-surface focus:outline-none";

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
  const router = useRouter();
  const { push } = useToast();

  // Sunucu çakışma bulursa kayıt YAPILMAZ ve conflictWarning döner; form uyarı
  // bandı + gizli confirm_conflict=1 ile ikinci gönderimde kayıt geçer.
  const [state, formAction, pending] = useActionState(
    async (_prev: AppointmentResult, formData: FormData): Promise<AppointmentResult> => {
      const result = await createAppointment(formData);
      if (result.ok) {
        push("Randevu planlandı", "ok");
        router.push("/app/randevular");
      }
      return result;
    },
    {},
  );
  const conflictWarning = state.conflictWarning ?? null;
  const error = !conflictWarning && state.error ? state.error : null;

  return (
    <form action={formAction}>
      <FormPage
        title="Yeni randevu planla"
        description="Yer gösterme, değerleme veya ofis görüşmesi ekleyin."
        breadcrumbs={[{ label: "Randevular", href: "/app/randevular" }, { label: "Yeni randevu" }]}
      >
        <FormSection title="Zaman" description="Randevunun türü, günü ve süresi.">
          <FormField label="Randevu türü" required htmlFor="appointment-type">
            <select id="appointment-type" name="appointment_type" required defaultValue="showing" className={selectClass}>
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Süre (dk)" htmlFor="appointment-duration">
            <Input id="appointment-duration" name="duration_min" inputMode="numeric" placeholder="45" />
          </FormField>
          <FormField label="Tarih" required htmlFor="appointment-date">
            <Input id="appointment-date" name="date" type="date" required defaultValue={defaultDate} />
          </FormField>
          <FormField label="Saat" required htmlFor="appointment-time">
            <Input id="appointment-time" name="time" type="time" required defaultValue={defaultTime} />
          </FormField>
        </FormSection>

        <FormSection title="Katılımcılar ve yer" description="Müşteri ve portföy yazarak aranır (Türkçe karakter duyarsız).">
          <FormField label="Müşteri">
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
          <FormField label="Portföy">
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
          <FormField label="Konum" htmlFor="appointment-location" className="sm:col-span-2">
            <div className="relative">
              <Input id="appointment-location" name="location" className="pr-9" placeholder="Onikişubat, Kahramanmaraş" />
              <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            </div>
          </FormField>
          <FormField label="Not" htmlFor="appointment-notes" className="sm:col-span-2">
            <Textarea id="appointment-notes" name="notes" rows={3} placeholder="Talep, hazırlık, dikkat edilecekler…" />
          </FormField>
        </FormSection>

        <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/5 px-4 py-3 text-xs font-semibold text-brand-600">
          <Sparkles className="h-4 w-4 shrink-0" /> Randevu “teyit bekliyor” olarak açılır; onaylayıp tamamlandığında komisyon akışına kaynak olur.
        </p>

        {error ? <p className="text-sm font-medium text-danger-600" role="alert">{error}</p> : null}

        {conflictWarning ? (
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
        ) : null}

        <FormActions>
          <ButtonLink href="/app/randevular" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending} icon={Check}>
            {pending ? "Planlanıyor…" : conflictWarning ? "Yine de kaydet" : "Randevuyu planla"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
