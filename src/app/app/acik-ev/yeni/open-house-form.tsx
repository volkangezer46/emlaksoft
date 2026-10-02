"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import { useCreateForm } from "@/components/app/use-create-form";
import { searchProperties } from "@/app/actions/lookup";
import { createOpenHouse } from "@/app/actions/targets-openhouse-sources";
import { detailOrList } from "@/lib/form-logic";

export function OpenHouseForm() {
  const [propertyId, setPropertyId] = useState("");
  const { onSubmit, pending, error } = useCreateForm((fd) => createOpenHouse({}, fd), {
    successMessage: "Açık ev günü oluşturuldu",
    redirectTo: (r) => detailOrList("/app/acik-ev", r.id),
  });

  return (
    <FormShell
      title="Yeni açık ev günü"
      description="Portföy seçin, tarih ve kapasiteyi belirleyin — ziyaretçileri kapıda ekrandan kaydedersiniz."
      breadcrumbs={[{ label: "Açık Ev", href: "/app/acik-ev" }, { label: "Yeni" }]}
      cancelHref="/app/acik-ev"
      submitLabel="Açık ev oluştur"
      submitIcon={Plus}
      submitDisabled={!propertyId}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Portföy ve zaman" description="Etkinliğin yapılacağı portföyü ve zamanı seçin.">
        <FormField label="Portföy" htmlFor="oh-property" required className="sm:col-span-2">
          <Combobox
            name="property_id"
            required
            aria-label="Portföy"
            value={propertyId}
            onValueChange={setPropertyId}
            options={[] as ComboboxOption[]}
            onSearch={searchProperties}
            placeholder="Portföy ara ve seçin"
            searchPlaceholder="Başlık, kod ya da adres…"
            emptyText="Eşleşen portföy yok"
          />
        </FormField>
        <FormField label="Tarih ve saat" htmlFor="oh-scheduled" required>
          <FormInput name="scheduled_at" type="datetime-local" required />
        </FormField>
        <FormField label="Süre (dk)" htmlFor="oh-duration">
          <FormInput name="duration_min" type="number" min={15} step={15} defaultValue={120} />
        </FormField>
      </FormSection>

      <FormSection title="Yer ve kapasite">
        <FormField label="Konum / buluşma noktası" htmlFor="oh-location" className="sm:col-span-2">
          <FormInput name="location" placeholder="Örn. site satış ofisi önü" />
        </FormField>
        <FormField label="Maks. ziyaretçi" htmlFor="oh-max" hint="Boş bırakılırsa sınırsız.">
          <FormInput name="max_visitors" type="number" min={1} placeholder="Sınırsız" />
        </FormField>
      </FormSection>

      <FormSection title="Not">
        <FormField label="Not" htmlFor="oh-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Hazırlık listesi, broşür, ikram…" />
        </FormField>
      </FormSection>
    </FormShell>
  );
}
