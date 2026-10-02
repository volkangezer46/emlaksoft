"use client";

import { useState } from "react";
import Link from "next/link";
import { Tag } from "lucide-react";
import { createOffer } from "@/app/actions/offers";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import { detailOrList } from "@/lib/form-logic";

type PropertyOption = { id: string; property_code: string; title: string | null; list_price: number | null };
type CustomerOption = { id: string; full_name: string };

const formatTl = (value: number) => new Intl.NumberFormat("tr-TR").format(value);

export function NewOfferForm({
  properties,
  customers,
  defaultPropertyId = null,
  defaultCustomerId = null,
  todayIso,
}: {
  properties: PropertyOption[];
  customers: CustomerOption[];
  /** ?portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu. */
  defaultPropertyId?: string | null;
  /** ?musteri= — aynı kısayolun müşteri ön dolgusu. */
  defaultCustomerId?: string | null;
  /** Geçerlilik tarihi alt sınırı (sunucudan; bileşende saat okunmaz). */
  todayIso: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createOffer({}, fd), {
    successMessage: "Teklif oluşturuldu",
    redirectTo: (r) => detailOrList("/app/teklifler", r.id),
    refresh: true,
  });

  const preselectedProperty = defaultPropertyId
    ? properties.find((p) => p.id === defaultPropertyId) ?? null
    : null;
  const [selectedPrice, setSelectedPrice] = useState<number | null>(preselectedProperty?.list_price ?? null);

  function handlePropertyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const prop = properties.find((p) => p.id === e.target.value);
    setSelectedPrice(prop?.list_price ?? null);
  }

  return (
    <FormShell
      title="Yeni teklif"
      description="Portföye gelen teklifi kaydedin; durum akışı otomatik başlar."
      breadcrumbs={[{ label: "Teklifler", href: "/app/teklifler" }, { label: "Yeni teklif" }]}
      cancelHref="/app/teklifler"
      submitLabel="Teklif oluştur"
      pendingLabel="Kaydediliyor…"
      submitIcon={Tag}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Taraflar" description="Teklifin yapıldığı portföy ve (varsa) müşteri.">
        <FormField
          label="Portföy"
          htmlFor="offer-property"
          required
          hint={
            properties.length === 0 ? (
              <Link href="/app/portfoyler/yeni" className="font-semibold text-brand-600 underline underline-offset-2">
                Kayıtlı portföy yok — yeni portföy ekle
              </Link>
            ) : undefined
          }
        >
          <FormSelect
            name="property_id"
            required
            defaultValue={preselectedProperty?.id ?? ""}
            onChange={handlePropertyChange}
          >
            <option value="">— Portföy seçin —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.property_code}{p.title ? ` — ${p.title}` : ""}
                {p.list_price ? ` (${formatTl(p.list_price)} ₺)` : ""}
              </option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Müşteri (opsiyonel)" htmlFor="offer-customer">
          <FormSelect
            name="customer_id"
            defaultValue={
              defaultCustomerId && customers.some((c) => c.id === defaultCustomerId) ? defaultCustomerId : ""
            }
          >
            <option value="">— Müşteri seçin —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </FormSelect>
        </FormField>
      </FormSection>

      <FormSection title="Teklif koşulları">
        <FormField
          label="Teklif tutarı (₺)"
          htmlFor="offer-amount"
          required
          hint={selectedPrice ? `Liste fiyatı: ${formatTl(selectedPrice)} ₺` : undefined}
        >
          <FormInput
            name="amount"
            type="number"
            min="1"
            step="1000"
            required
            defaultValue={selectedPrice ?? ""}
            key={selectedPrice ?? "no-price"} // mülk değişince sıfırla
            placeholder="ör. 3500000"
          />
        </FormField>
        <FormField label="Geçerlilik tarihi (opsiyonel)" htmlFor="offer-valid">
          <FormInput name="valid_until" type="date" min={todayIso} />
        </FormField>
        <FormField label="Not" htmlFor="offer-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Teklif koşulları, özel notlar…" />
        </FormField>
      </FormSection>
    </FormShell>
  );
}
