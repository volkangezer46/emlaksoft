"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { createDemand, type DemandResult } from "@/app/actions/demands";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";

type Province = { id: string; name: string };
type CustomerOption = { id: string; full_name: string };

const initial: DemandResult = {};

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";
const labelClass = "mb-1.5 block text-sm text-text-muted";

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
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: DemandResult, formData: FormData) => {
    const result = await createDemand(prev, formData);
    if (result.ok) {
      toast.push("Talep kaydedildi");
      router.push(fixedCustomer ? cancelHref : result.id ? `/app/talepler/${result.id}` : cancelHref);
    }
    return result;
  }, initial);

  return (
    <form action={action}>
      <FormPage title="Yeni talep" description={description} breadcrumbs={breadcrumbs}>
        <FormSection title="Müşteri ve işlem" description="Talebin sahibi ve ne aradığı.">
          {fixedCustomer ? (
            <input type="hidden" name="customer_id" value={fixedCustomer.id} />
          ) : (
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="demand-customer">Müşteri *</label>
              <select
                id="demand-customer"
                name="customer_id"
                required
                defaultValue={customers.some((c) => c.id === defaultCustomerId) ? defaultCustomerId : ""}
                className={fieldClass}
              >
                <option value="" disabled>Müşteri seçin…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={labelClass} htmlFor="demand-tx">İşlem türü *</label>
            <select id="demand-tx" name="transaction_type" required defaultValue="Satılık" className={fieldClass}>
              {transactionTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="demand-type">Portföy türü</label>
            <select id="demand-type" name="property_type" defaultValue="Daire" className={fieldClass}>
              {propertyTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="demand-urgency">Aciliyet</label>
            <select id="demand-urgency" name="urgency" defaultValue="normal" className={fieldClass}>
              {urgencyOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </FormSection>

        <FormSection title="Kriterler" description="Eşleştirme motoru bu değerlerle portföyleri önerir.">
          <div>
            <label className={labelClass} htmlFor="demand-budget-min">Bütçe min</label>
            <input id="demand-budget-min" name="budget_min" inputMode="decimal" className={fieldClass} placeholder="5.000.000" />
          </div>
          <div>
            <label className={labelClass} htmlFor="demand-budget-max">Bütçe max</label>
            <input id="demand-budget-max" name="budget_max" inputMode="decimal" className={fieldClass} placeholder="7.500.000" />
          </div>
          <div>
            <label className={labelClass} htmlFor="demand-rooms">Oda</label>
            <input id="demand-rooms" name="rooms" className={fieldClass} placeholder="3+1" />
          </div>
          <div>
            <label className={labelClass} htmlFor="demand-sqm">Min m²</label>
            <input id="demand-sqm" name="min_sqm" inputMode="decimal" className={fieldClass} placeholder="120" />
          </div>
        </FormSection>

        <FormSection
          title="Bölge"
          description="Eşleştirme motoru portföy ilçesi ile talep ilçesini karşılaştırır; ilçe seçmek sonucu keskinleştirir."
        >
          <div className="sm:col-span-2">
            <GeoSelect provinces={provinces} defaultProvinceId={defaultProvinceId} />
          </div>
        </FormSection>

        {state.error ? (
          <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p>
        ) : null}

        <FormActions>
          <ButtonLink href={cancelHref} variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending} icon={Save}>
            {pending ? "Kaydediliyor…" : "Talebi kaydet"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
