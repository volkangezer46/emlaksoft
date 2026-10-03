"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createRental } from "@/app/actions/rentals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { parseLooseNumber } from "@/lib/form-tabs";
import { RENTAL_DRAFT_FIELDS, RENTAL_FORM_ID, RENTAL_TABS } from "./rental-tabs";

type Property = { id: string; property_code: string; title: string | null };
type Customer = { id: string; full_name: string | null; phone: string | null };

const TAB_ICONS = {
  taraflar: TI.taraflar,
  bedel: TI.fiyat,
  sure: TI.sure,
} as const;

const FIELD_LABELS = {
  property_id: "Portföy",
  renter_customer_id: "Kiracı",
  monthly_rent: "Aylık kira",
  due_day: "Vade günü",
  start_date: "Başlangıç tarihi",
};

const formatTry = (n: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n)} ₺`;

/** "YYYY-MM-DD" -> "GG.AA.YYYY" (yalnız biçim). */
function dayLabel(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

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
  userId,
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
  userId: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createRental({}, fd), {
    successMessage: "Kira kaydı oluşturuldu",
    redirectTo: () => "/app/kiralama",
  });

  const tabs: FormTab[] = useMemo(
    () =>
      RENTAL_TABS.map((t) => ({
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
    taraflar: (
      <>
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
      </>
    ),
    bedel: (
      <>
        <FormField label="Aylık kira (₺)" htmlFor="rental-monthly-rent" required>
          <FormInput name="monthly_rent" type="number" min="1" step="0.01" required defaultValue={defaultMonthlyRent ?? undefined} placeholder="ör. 25.000" />
        </FormField>
        <FormField label="Vade günü" htmlFor="rental-due-day" required hint="Ayın kaçında ödenir (1-28).">
          <FormInput name="due_day" type="number" min="1" max="28" step="1" required defaultValue={1} />
        </FormField>
        <FormField label="Depozito (₺)" htmlFor="rental-deposit">
          <FormInput name="deposit" type="number" min="0" step="0.01" placeholder="Opsiyonel" />
        </FormField>
      </>
    ),
    sure: (
      <>
        <FormField label="Başlangıç tarihi" htmlFor="rental-start-date" required>
          <FormInput name="start_date" type="date" required defaultValue={defaultStartDate} />
        </FormField>
        <FormField label="Bitiş tarihi" htmlFor="rental-end-date" hint="Boş bırakılabilir — süresiz sözleşme.">
          <FormInput name="end_date" type="date" />
        </FormField>
        <FormField label="Notlar" htmlFor="rental-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Sözleşme koşulları, özel notlar…" />
        </FormField>
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const propertyId = (values.property_id ?? "").trim();
    const renterId = (values.renter_customer_id ?? "").trim();
    const property = properties.find((p) => p.id === propertyId);
    const propertyText = propertyId ? (property ? (property.title ?? property.property_code) : (display.property_id ?? null)) : null;
    // Kiracı: ad (telefon gerçek değeriyle "Girilen bilgiler" listesinde görünür).
    const renterText = renterId ? (customers.find((c) => c.id === renterId)?.full_name ?? display.renter_customer_id ?? null) : null;
    const rent = parseLooseNumber(values.monthly_rent);
    const deposit = parseLooseNumber(values.deposit);
    const dueDay = (values.due_day ?? "").trim();
    const start = dayLabel(values.start_date);
    const end = dayLabel(values.end_date);
    const notes = (values.notes ?? "").trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{propertyText ?? "Portföy seçilmedi"}</p>
          <p className="mt-0.5 truncate text-xs text-text-muted">{renterText ? `Kiracı: ${renterText}` : "Kiracı seçilmedi"}</p>
          <p className="numeric mt-1.5 text-sm font-semibold text-ink-950">
            {rent != null && rent > 0 ? `${formatTry(rent)} / ay` : "Aylık kira girilmedi"}
          </p>
        </div>
        <SummaryGroup title="Kira bilgisi">
          <SummaryRow label="Portföy" value={propertyText ?? "Zorunlu"} muted={!propertyText} tab="taraflar" field="property_id" />
          <SummaryRow label="Kiracı" value={renterText ?? "Zorunlu"} muted={!renterText} tab="taraflar" field="renter_customer_id" />
          <SummaryRow label="Aylık kira" value={rent != null && rent > 0 ? formatTry(rent) : "Zorunlu"} muted={!(rent != null && rent > 0)} tab="bedel" field="monthly_rent" />
          <SummaryRow label="Yıllık bedel" value={rent != null && rent > 0 ? formatTry(rent * 12) : "Hesaplanamadı"} muted={!(rent != null && rent > 0)} tab="bedel" field="monthly_rent" />
          <SummaryRow label="Vade günü" value={dueDay ? `Ayın ${dueDay}. günü` : "Zorunlu"} muted={!dueDay} tab="bedel" field="due_day" />
          <SummaryRow label="Depozito" value={deposit != null && deposit > 0 ? formatTry(deposit) : "Girilmedi"} muted={!(deposit != null && deposit > 0)} tab="bedel" field="deposit" />
          <SummaryRow label="Başlangıç" value={start ?? "Zorunlu"} muted={!start} tab="sure" field="start_date" />
          <SummaryRow label="Bitiş" value={end ?? "Süresiz"} muted={!end} tab="sure" field="end_date" />
          <SummaryRow label="Notlar" value={notes || "Girilmedi"} muted={!notes} tab="sure" field="notes" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni kira kaydı"
      description="Portföyü kiracısıyla eşleştirin — aylık tahakkuklar vade gününe göre otomatik oluşturulur."
      breadcrumbs={[{ label: "Kiralama", href: "/app/kiralama" }, { label: "Yeni kira kaydı" }]}
      cancelHref="/app/kiralama"
      submitLabel="Kaydet"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: RENTAL_FORM_ID, fields: [...RENTAL_DRAFT_FIELDS] }}
    />
  );
}
