"use client";

import { CustomFieldInputs, type CustomFieldInputDef } from "@/components/app/custom-field-inputs";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/smart-link";
import { Save, UserRound } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createDemand } from "@/app/actions/demands";
import { searchCustomers } from "@/app/actions/lookup";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DuplicateHint } from "@/components/app/duplicate-hint";
import { DemandSummaryGroups } from "@/components/app/demand-summary";
import { StructuredDemandFields, useDemandRequired } from "@/components/app/structured-demand-fields";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField } from "@/components/ui/form-controls";
import {
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import { detailOrList } from "@/lib/form-logic";
import { DEMAND_DRAFT_FIELDS, DEMAND_FORM_ID, DEMAND_TABS } from "./demand-tabs";

type Province = { id: string; name: string };
type CustomerOption = { id: string; full_name: string };

const TAB_ICONS = {
  musteri: TI.kisi,
  kriter: TI.kriter,
  bolge: TI.bolge,
} as const;

const FIELD_LABELS = { customer_id: "Müşteri", transaction_type: "İşlem türü" };

/**
 * Yeni talep formu — iki girişte ortak: talepler listesi (müşteri seçilir) ve
 * müşteri-360 (müşteri sabit, `fixedCustomer`). Aynı createDemand action'ı.
 * Talep alanları müşteri formundaki "Talep ve kriterler" sekmesiyle AYNI bileşendir
 * (`StructuredDemandFields`); burada yalnız müşteri seçimi ve sekme yerleşimi vardır.
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
  customFields = [],
}: {
  /** Ofisin etkin özel alanları (yeni kayıtta girilir; doğrulama/yazım sunucuda). */
  customFields?: CustomFieldInputDef[];
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
  const req = useDemandRequired();

  // Müşteri seçici sunucu taraflı aranır (searchCustomers); seçilen ad özet için tutulur.
  const prefill = customers.find((c) => c.id === defaultCustomerId) ?? null;
  const [pickedCustomer, setPickedCustomer] = useState<CustomerOption | null>(prefill);
  const customerCache = useRef(new Map<string, CustomerOption>());
  const onSearchCustomers = useCallback(async (q: string): Promise<ComboboxOption[]> => {
    const rows = await searchCustomers(q);
    for (const r of rows) customerCache.current.set(r.value, { id: r.value, full_name: r.label });
    return rows;
  }, []);

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

  const shared = { req, transactionTypes, propertyTypes, urgencyOptions, provinces, defaultProvinceId };

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
            inject={false}
          >
            <Combobox
              id="demand-customer"
              name="customer_id"
              aria-label="Müşteri"
              required
              clearable={false}
              placeholder="Müşteri seçin…"
              searchPlaceholder="Müşteri ara…"
              emptyText="Eşleşen müşteri yok"
              defaultValue={prefill?.id ?? ""}
              options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
              onSearch={onSearchCustomers}
              onValueChange={(id) => setPickedCustomer(id ? (customerCache.current.get(id) ?? null) : null)}
            />
            <Link href="/app/musteriler/yeni" className="mt-1 inline-block text-xs font-semibold text-brand-600 underline underline-offset-2">
              Yeni müşteri ekle
            </Link>
          </FormField>
        )}
        <StructuredDemandFields section="ne" {...shared} />
      </>
    ),
    kriter: <StructuredDemandFields section="kriter" {...shared} />,
    bolge: <StructuredDemandFields section="bolge" {...shared} />,
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const customerId = fixedCustomer?.id ?? values.customer_id ?? "";
    const customerName = fixedCustomer?.full_name ?? (pickedCustomer && pickedCustomer.id === customerId ? pickedCustomer.full_name : undefined);
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
        <SummaryGroup title="Müşteri">
          <SummaryRow label="Müşteri" value={customerName ?? "Zorunlu"} muted={!customerName} tab="musteri" field="customer_id" />
        </SummaryGroup>
        <DemandSummaryGroups
          values={values}
          provinces={provinces}
          urgencyOptions={urgencyOptions}
          display={display}
          tabs={{ ne: "musteri", kriter: "kriter", bolge: "bolge" }}
        />
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
      notice={<DuplicateHint kind="demand" />}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={{ ...tabPanels, musteri: <>{tabPanels.musteri}<CustomFieldInputs defs={customFields} /></> }}
      summary={renderSummary}
      saveAndNew
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: DEMAND_FORM_ID, fields: [...DEMAND_DRAFT_FIELDS] }}
    />
  );
}
