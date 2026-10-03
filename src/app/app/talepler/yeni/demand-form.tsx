"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MapPin, Save, SlidersHorizontal, UserRound } from "lucide-react";
import { createDemand } from "@/app/actions/demands";
import { GeoSelect } from "@/components/app/geo-select";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import { detailOrList } from "@/lib/form-logic";
import { parseLooseNumber } from "@/lib/form-tabs";
import { formatTry } from "@/lib/utils";
import { DEMAND_DRAFT_FIELDS, DEMAND_FORM_ID, DEMAND_TABS } from "./demand-tabs";

type Province = { id: string; name: string };
type CustomerOption = { id: string; full_name: string };

const TAB_ICONS = {
  musteri: UserRound,
  kriter: SlidersHorizontal,
  bolge: MapPin,
} as const;

const FIELD_LABELS = { customer_id: "Müşteri", transaction_type: "İşlem türü" };

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
  userId,
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
  userId: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createDemand({}, fd), {
    successMessage: "Talep kaydedildi",
    redirectTo: (r) => (fixedCustomer || !r.id ? cancelHref : detailOrList("/app/talepler", r.id)),
  });

  const tabs: FormTab[] = useMemo(
    () =>
      DEMAND_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  const tabPanels = {
    musteri: (
      <>
        {fixedCustomer ? (
          <>
            <input type="hidden" name="customer_id" value={fixedCustomer.id} />
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2.5 sm:col-span-2">
              <UserRound className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Müşteri</p>
                <Link
                  href={`/app/musteriler/${fixedCustomer.id}`}
                  className="block truncate text-sm font-semibold text-ink-950 hover:underline"
                >
                  {fixedCustomer.full_name}
                </Link>
              </div>
            </div>
          </>
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
        <FormField label="Aciliyet" htmlFor="demand-urgency" hint="Acil talepler eşleştirme ve takip listelerinde öne çıkar.">
          <FormSelect name="urgency" defaultValue="normal">
            {urgencyOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
        </FormField>
      </>
    ),
    kriter: (
      <>
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
      </>
    ),
    bolge: (
      <div className="sm:col-span-2">
        <GeoSelect provinces={provinces} defaultProvinceId={defaultProvinceId} />
      </div>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const customerId = fixedCustomer?.id ?? values.customer_id ?? "";
    const customerName = fixedCustomer?.full_name ?? customers.find((c) => c.id === customerId)?.full_name;
    const urgency = urgencyOptions.find((o) => o.value === values.urgency)?.label;
    const min = parseLooseNumber(values.budget_min);
    const max = parseLooseNumber(values.budget_max);
    const budget =
      min != null && max != null
        ? `${formatTry(min)} – ${formatTry(max)}`
        : min != null
          ? `${formatTry(min)} ve üzeri`
          : max != null
            ? `${formatTry(max)} altı`
            : null;
    const inverted = min != null && max != null && min > max;
    const sqm = parseLooseNumber(values.min_sqm);
    const rooms = (values.rooms ?? "").trim();
    const province = provinces.find((p) => p.id === values.province_id)?.name;
    const hasDistrict = (values.district_id ?? "") !== "";
    return (
      <>
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-700">
            <UserRound className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-950">{customerName ?? "Müşteri seçilmedi"}</p>
            <p className="truncate text-xs text-text-muted">
              {[values.transaction_type, values.property_type].filter(Boolean).join(" · ") || "İşlem seçilmedi"}
            </p>
          </div>
        </div>
        <SummaryGroup title="Talep">
          <SummaryRow label="Müşteri" value={customerName ?? "Zorunlu"} muted={!customerName} tab="musteri" field="customer_id" />
          <SummaryRow label="İşlem" value={values.transaction_type || "Zorunlu"} muted={!values.transaction_type} tab="musteri" field="transaction_type" />
          <SummaryRow label="Aciliyet" value={urgency ?? "Normal"} muted={!urgency} tab="musteri" field="urgency" />
        </SummaryGroup>
        <SummaryGroup title="Kriterler">
          <SummaryRow label="Bütçe" value={budget ?? "Girilmedi"} muted={!budget} tab="kriter" field="budget_min" />
          {inverted ? (
            <p role="status" className="px-2 pb-1 text-xs font-medium text-amber-800">
              Bütçe min, max değerinden büyük; kontrol edin.
            </p>
          ) : null}
          <SummaryRow label="Oda" value={rooms || "Girilmedi"} muted={!rooms} tab="kriter" field="rooms" />
          <SummaryRow label="Min m²" value={sqm != null && sqm > 0 ? `${new Intl.NumberFormat("tr-TR").format(sqm)} m²` : "Girilmedi"} muted={!(sqm != null && sqm > 0)} tab="kriter" field="min_sqm" />
        </SummaryGroup>
        <SummaryGroup title="Bölge">
          <SummaryRow label="İl" value={province ?? "Seçilmedi"} muted={!province} tab="bolge" />
          <SummaryRow label="İlçe" value={hasDistrict ? "Seçildi" : "Seçilmedi"} muted={!hasDistrict} tab="bolge" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
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
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: DEMAND_FORM_ID, fields: [...DEMAND_DRAFT_FIELDS] }}
    />
  );
}
