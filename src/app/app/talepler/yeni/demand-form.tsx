"use client";

import Link from "next/link";
import { Save } from "lucide-react";
import { createDemand } from "@/app/actions/demands";
import { GeoSelect } from "@/components/app/geo-select";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import { detailOrList } from "@/lib/form-logic";

type Province = { id: string; name: string };
type CustomerOption = { id: string; full_name: string };

/**
 * Yeni talep formu — iki girişte ortak: talepler listesi (müşteri seçilir) ve
 * müşteri-360 (müşteri sabit, `fixedCustomer`). Aynı createDemand action'ı.
 */
export function DemandForm({
  customers = [],
  fixedCustomer,
  defaultCustomerId,
  provinces,
  defaultProvinceId,
  transactionTypes,
  propertyTypes,
  urgencyOptions,
  cancelHref,
  breadcrumbs,
  description,
}: {
  customers?: CustomerOption[];
  fixedCustomer?: CustomerOption;
  defaultCustomerId?: string;
  provinces: Province[];
  defaultProvinceId?: string | null;
  transactionTypes: string[];
  propertyTypes: string[];
  urgencyOptions: { value: string; label: string }[];
  cancelHref: string;
  breadcrumbs: BreadcrumbItem[];
  description: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createDemand({}, fd), {
    successMessage: "Talep kaydedildi",
    redirectTo: (r) => (fixedCustomer || !r.id ? cancelHref : detailOrList("/app/talepler", r.id)),
  });

  return (
    <FormShell
      title="Yeni talep"
      description={description}
      breadcrumbs={breadcrumbs}
      cancelHref={cancelHref}
      submitLabel="Talebi kaydet"
      pendingLabel="Kaydediliyor…"
      submitIcon={Save}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Müşteri ve işlem" description="Talebin sahibi ve ne aradığı.">
        {fixedCustomer ? (
          <input type="hidden" name="customer_id" value={fixedCustomer.id} />
        ) : (
          <FormField
            label="Müşteri"
            htmlFor="demand-customer"
            required
            className="sm:col-span-2"
            hint={
              customers.length === 0 ? (
                <Link href="/app/musteriler/yeni" className="font-semibold text-brand-600 underline underline-offset-2">
                  Kayıtlı müşteri yok — yeni müşteri ekle
                </Link>
              ) : undefined
            }
          >
            <FormSelect
              name="customer_id"
              required
              defaultValue={customers.some((c) => c.id === defaultCustomerId) ? defaultCustomerId : ""}
            >
              <option value="" disabled>Müşteri seçin…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </FormSelect>
          </FormField>
        )}
        <FormField label="İşlem türü" htmlFor="demand-tx" required>
          <FormSelect name="transaction_type" required defaultValue="Satılık">
            {transactionTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Portföy türü" htmlFor="demand-type">
          <FormSelect name="property_type" defaultValue="Daire">
            {propertyTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Aciliyet" htmlFor="demand-urgency">
          <FormSelect name="urgency" defaultValue="normal">
            {urgencyOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
        </FormField>
      </FormSection>

      <FormSection title="Kriterler" description="Eşleştirme motoru bu değerlerle portföyleri önerir.">
        <FormField label="Bütçe min" htmlFor="demand-budget-min">
          <FormInput name="budget_min" inputMode="decimal" placeholder="5.000.000" />
        </FormField>
        <FormField label="Bütçe max" htmlFor="demand-budget-max">
          <FormInput name="budget_max" inputMode="decimal" placeholder="7.500.000" />
        </FormField>
        <FormField label="Oda" htmlFor="demand-rooms">
          <FormInput name="rooms" placeholder="3+1" />
        </FormField>
        <FormField label="Min m²" htmlFor="demand-sqm">
          <FormInput name="min_sqm" inputMode="decimal" placeholder="120" />
        </FormField>
      </FormSection>

      <FormSection
        title="Bölge"
        description="Eşleştirme motoru portföy ilçesi ile talep ilçesini karşılaştırır; ilçe seçmek sonucu keskinleştirir."
      >
        <div className="sm:col-span-2">
          <GeoSelect provinces={provinces} defaultProvinceId={defaultProvinceId} />
        </div>
      </FormSection>
    </FormShell>
  );
}
