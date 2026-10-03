"use client";

import { Save } from "lucide-react";
import { createCustomer } from "@/app/actions/customers";
import { GeoSelect } from "@/components/app/geo-select";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea, fieldClass } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import { PhoneInput } from "@/components/ui/phone-input";
import { detailOrList } from "@/lib/form-logic";
import { EmailInput } from "@/components/ui/email-input";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

export function CustomerForm({
  provinces,
  branches,
  types,
}: {
  provinces: Province[];
  branches: Branch[];
  types: string[];
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createCustomer({}, fd), {
    successMessage: "Müşteri kaydedildi",
    redirectTo: (r) => detailOrList("/app/musteriler", r.id),
  });

  return (
    <FormShell
      title="Yeni müşteri"
      description="Temel bilgilerle müşteri kaydı açın."
      breadcrumbs={[{ label: "Müşteriler", href: "/app/musteriler" }, { label: "Yeni müşteri" }]}
      cancelHref="/app/musteriler"
      submitLabel="Kaydet"
      pendingLabel="Kaydediliyor…"
      submitIcon={Save}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Kişi bilgileri" description="Ad soyad zorunludur; iletişim bilgileri sonradan eklenebilir.">
        <FormField label="Ad soyad" htmlFor="full_name" required className="sm:col-span-2">
          <FormInput name="full_name" required placeholder="Örn. Ali Kaya" />
        </FormField>
        <FormField label="Telefon" htmlFor="phone">
          <PhoneInput name="phone" className={fieldClass} />
        </FormField>
        <FormField label="E-posta" htmlFor="email">
          <EmailInput name="email" />
        </FormField>
        <FormField label="Müşteri türü" htmlFor="type">
          <FormSelect name="type" defaultValue="Alıcı">
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </FormSelect>
        </FormField>
        {branches.length > 0 ? (
          <FormField label="Şube" htmlFor="branch_id">
            <FormSelect name="branch_id" defaultValue="">
              <option value="">Şube atanmadı</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </FormSelect>
          </FormField>
        ) : null}
      </FormSection>

      <FormSection title="Bölge" description="İlçe, bölge bazlı raporlama ve filtreleme için kullanılır.">
        {/* Müşteride mahalle gereksiz; ilçe yeterli. */}
        <div className="sm:col-span-2">
          <GeoSelect provinces={provinces} withNeighborhood={false} />
        </div>
      </FormSection>

      <FormSection title="Özel günler" description="Doğum günü ve yıldönümü hatırlatmaları için.">
        <FormField label="Doğum tarihi" htmlFor="birth_date">
          <FormInput name="birth_date" type="date" max="2100-12-31" />
        </FormField>
        <FormField label="Yıldönümü" htmlFor="anniversary_date">
          <FormInput name="anniversary_date" type="date" max="2100-12-31" />
        </FormField>
        <FormField label="Yıldönümü notu" htmlFor="anniversary_note" className="sm:col-span-2">
          <FormInput name="anniversary_note" placeholder="Örn. İlk ev alımı, 3 yıllık kiracı" />
        </FormField>
      </FormSection>

      <FormSection title="Not">
        <FormField label="Not" htmlFor="notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Talep, bütçe, tercih vb." />
        </FormField>
      </FormSection>
    </FormShell>
  );
}
