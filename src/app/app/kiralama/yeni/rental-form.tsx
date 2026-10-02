"use client";

import { Check } from "lucide-react";
import { createRental } from "@/app/actions/rentals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";

type Property = { id: string; property_code: string; title: string | null };
type Customer = { id: string; full_name: string | null; phone: string | null };

/**
 * "Yeni kira kaydı" tam sayfa formu — portföy + kiracı müşteri Combobox'la seçilir
 * (ilk liste son eklenenler, yazınca sunucu taraflı arama devreye girer).
 * Kiracı için yeni kişi tablosu yok: mevcut müşteri kaydı seçilir, action
 * tarafında 'Kiracı' tip etiketi eklenir.
 */
export function RentalForm({
  properties,
  customers,
  defaultPropertyId = null,
  defaultCustomerId = null,
  defaultMonthlyRent = null,
  defaultStartDate,
}: {
  properties: Property[];
  customers: Customer[];
  /** ?portfoy= — kazanılan kira anlaşmasından gelen portföy ön dolgusu. */
  defaultPropertyId?: string | null;
  /** ?musteri= — anlaşmanın müşterisi kiracı olarak ön seçilir. */
  defaultCustomerId?: string | null;
  /** ?tutar= — anlaşma değeri aylık kira alanına ön dolgu düşer. */
  defaultMonthlyRent?: number | null;
  /** Sunucudan gelen bugün (YYYY-MM-DD). */
  defaultStartDate: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createRental({}, fd), {
    successMessage: "Kira kaydı oluşturuldu",
    redirectTo: () => "/app/kiralama",
  });

  return (
    <FormShell
      title="Yeni kira kaydı"
      description="Portföyü kiracısıyla eşleştirin — aylık tahakkuklar vade gününe göre otomatik oluşturulur."
      breadcrumbs={[{ label: "Kiralama", href: "/app/kiralama" }, { label: "Yeni kira kaydı" }]}
      cancelHref="/app/kiralama"
      submitLabel="Kaydet"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Taraflar" description="Kiralanan portföy ve kiracı müşteri.">
        <FormField label="Portföy" htmlFor="rental-property" required className="sm:col-span-2">
          <Combobox
            name="property_id"
            required
            clearable={false}
            aria-label="Portföy"
            placeholder="Portföy seçin"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            defaultValue={defaultPropertyId ?? undefined}
            options={properties.map((p) => ({
              value: p.id,
              label: p.title ?? p.property_code,
              hint: p.title ? p.property_code : undefined,
            }))}
          />
        </FormField>
        <FormField
          label="Kiracı (müşteri)"
          htmlFor="rental-renter"
          required
          hint="Mevcut müşteri kaydı seçilir; 'Kiracı' tip etiketi otomatik eklenir."
          className="sm:col-span-2"
        >
          <Combobox
            name="renter_customer_id"
            required
            clearable={false}
            aria-label="Kiracı (müşteri)"
            placeholder="Müşteri seçin"
            searchPlaceholder="Ad ya da telefon ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            defaultValue={defaultCustomerId ?? undefined}
            options={customers.map((c) => ({
              value: c.id,
              label: c.full_name ?? "İsimsiz",
              hint: c.phone ?? undefined,
            }))}
          />
        </FormField>
      </FormSection>

      <FormSection title="Bedel ve vade" description="Aylık kira, ödeme günü ve depozito.">
        <FormField label="Aylık kira (₺)" htmlFor="rental-monthly-rent" required>
          <FormInput name="monthly_rent" type="number" min="1" step="0.01" required defaultValue={defaultMonthlyRent ?? undefined} placeholder="ör. 25.000" />
        </FormField>
        <FormField label="Vade günü" htmlFor="rental-due-day" required hint="Ayın kaçında ödenir (1-28).">
          <FormInput name="due_day" type="number" min="1" max="28" step="1" required defaultValue={1} />
        </FormField>
        <FormField label="Depozito (₺)" htmlFor="rental-deposit">
          <FormInput name="deposit" type="number" min="0" step="0.01" placeholder="Opsiyonel" />
        </FormField>
      </FormSection>

      <FormSection title="Süre ve notlar" description="Sözleşme dönemi ve özel koşullar.">
        <FormField label="Başlangıç tarihi" htmlFor="rental-start-date" required>
          <FormInput name="start_date" type="date" required defaultValue={defaultStartDate} />
        </FormField>
        <FormField label="Bitiş tarihi" htmlFor="rental-end-date" hint="Boş bırakılabilir — süresiz sözleşme.">
          <FormInput name="end_date" type="date" />
        </FormField>
        <FormField label="Notlar" htmlFor="rental-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Sözleşme koşulları, özel notlar…" />
        </FormField>
      </FormSection>
    </FormShell>
  );
}
