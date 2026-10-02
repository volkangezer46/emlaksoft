"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { useToast } from "@/components/app/toast-provider";
import { searchProperties } from "@/app/actions/lookup";
import { createOpenHouse, type OpenHouseResult } from "@/app/actions/targets-openhouse-sources";

const init: OpenHouseResult = {};

export function OpenHouseForm() {
  const router = useRouter();
  const { push } = useToast();
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await createOpenHouse(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      push("Açık ev günü oluşturuldu", "ok");
      router.push(res.id ? `/app/acik-ev/${res.id}` : "/app/acik-ev");
    });
  };

  return (
    <form action={action}>
      <FormPage
        title="Yeni açık ev günü"
        description="Portföy seçin, tarih ve kapasiteyi belirleyin — ziyaretçileri kapıda ekrandan kaydedersiniz."
        breadcrumbs={[{ label: "Açık Ev", href: "/app/acik-ev" }, { label: "Yeni" }]}
      >
        <FormSection title="Portföy ve zaman" description="Etkinliğin yapılacağı portföyü ve zamanı seçin.">
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-ink-950">
              Portföy <span className="text-danger-500">*</span>
            </span>
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
          </div>
          <FormField label="Tarih ve saat" htmlFor="oh-scheduled" required>
            <Input id="oh-scheduled" name="scheduled_at" type="datetime-local" required />
          </FormField>
          <FormField label="Süre (dk)" htmlFor="oh-duration">
            <Input id="oh-duration" name="duration_min" type="number" min={15} step={15} defaultValue={120} />
          </FormField>
        </FormSection>

        <FormSection title="Yer ve kapasite">
          <FormField label="Konum / buluşma noktası" htmlFor="oh-location" className="sm:col-span-2">
            <Input id="oh-location" name="location" placeholder="Örn. site satış ofisi önü" />
          </FormField>
          <FormField label="Maks. ziyaretçi" htmlFor="oh-max" hint="Boş bırakılırsa sınırsız.">
            <Input id="oh-max" name="max_visitors" type="number" min={1} placeholder="Sınırsız" />
          </FormField>
        </FormSection>

        <FormSection title="Not">
          <FormField label="Not" htmlFor="oh-notes" className="sm:col-span-2">
            <Textarea id="oh-notes" name="notes" rows={3} placeholder="Hazırlık listesi, broşür, ikram…" />
          </FormField>
        </FormSection>

        {error ? (
          <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
            {error}
          </p>
        ) : null}

        <FormActions>
          <ButtonLink href="/app/acik-ev" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending} disabled={!propertyId}>
            <Plus className="h-4 w-4" /> Açık ev oluştur
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
