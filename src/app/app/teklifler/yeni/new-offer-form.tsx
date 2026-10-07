"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/smart-link";
import { Tag } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createOffer } from "@/app/actions/offers";
import {
  getPropertyPriceSummary,
  searchCustomers,
  searchOfferProperties,
  type PropertyPriceSummary,
} from "@/app/actions/lookup";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import {
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import { detailOrList } from "@/lib/form-logic";
import { parseLooseNumber } from "@/lib/form-tabs";
import { formatTry } from "@/lib/utils";
import { OFFER_DRAFT_FIELDS, OFFER_FORM_ID, OFFER_TABS } from "./offer-tabs";
import { formatNumberTr } from "@/lib/format";

type PropertyOption = PropertyPriceSummary;
type CustomerOption = { id: string; full_name: string };

const formatTl = formatNumberTr;

const TAB_ICONS = { taraflar: TI.taraflar, kosullar: TI.kosullar } as const;

const FIELD_LABELS = { property_id: "Portföy", amount: "Teklif tutarı" };

export function NewOfferForm({
  prefillProperty = null,
  prefillCustomer = null,
  todayIso,
  userId,
}: {
  /** ?portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu (tek kayıt). */
  prefillProperty?: PropertyOption | null;
  /** ?musteri= — aynı kısayolun müşteri ön dolgusu (tek kayıt). */
  prefillCustomer?: CustomerOption | null;
  /** Geçerlilik tarihi alt sınırı (sunucudan; bileşende saat okunmaz). */
  todayIso: string;
  userId: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createOffer({}, fd), {
    successMessage: "Teklif oluşturuldu",
    redirectTo: (r) => detailOrList("/app/teklifler", r.id),
    refresh: true,
  });

  // Seçiciler sunucu taraflı aranır; seçilen kayıtlar özet/fiyat için burada tutulur.
  const [pickedProperty, setPickedProperty] = useState<PropertyOption | null>(prefillProperty);
  const [pickedCustomer, setPickedCustomer] = useState<CustomerOption | null>(prefillCustomer);
  const [selectedPrice, setSelectedPrice] = useState<number | null>(prefillProperty?.list_price ?? null);
  const propertyCache = useRef(new Map<string, PropertyOption>());
  const customerCache = useRef(new Map<string, CustomerOption>());

  const propertyOption = (p: PropertyOption): ComboboxOption => ({
    value: p.id,
    label: p.title ?? "Başlıksız portföy",
    hint: `${p.property_code}${p.list_price ? ` · ${formatTl(p.list_price)} ₺` : ""}`,
  });

  const onSearchProperties = useCallback(async (q: string): Promise<ComboboxOption[]> => {
    const rows = await searchOfferProperties(q);
    for (const r of rows) propertyCache.current.set(r.id, r);
    return rows.map((p) => ({
      value: p.id,
      label: p.title ?? "Başlıksız portföy",
      hint: `${p.property_code}${p.list_price ? ` · ${formatTl(p.list_price)} ₺` : ""}`,
    }));
  }, []);

  const onSearchCustomers = useCallback(async (q: string): Promise<ComboboxOption[]> => {
    const rows = await searchCustomers(q);
    for (const r of rows) customerCache.current.set(r.value, { id: r.value, full_name: r.label });
    return rows;
  }, []);

  async function handlePropertyChange(id: string) {
    if (!id) {
      setPickedProperty(null);
      setSelectedPrice(null);
      return;
    }
    const prop = propertyCache.current.get(id) ?? (await getPropertyPriceSummary(id));
    setPickedProperty(prop);
    setSelectedPrice(prop?.list_price ?? null);
  }

  function handleCustomerChange(id: string) {
    setPickedCustomer(id ? (customerCache.current.get(id) ?? null) : null);
  }

  const tabs: FormTab[] = useMemo(
    () =>
      OFFER_TABS.map((t) => ({
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
        <FormField
          label="Portföy"
          htmlFor="offer-property"
          required
          inject={false}
          className="sm:col-span-2"
        >
          <Combobox
            id="offer-property"
            name="property_id"
            aria-label="Portföy"
            required
            clearable={false}
            placeholder="— Portföy seçin —"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            defaultValue={prefillProperty?.id ?? ""}
            options={prefillProperty ? [propertyOption(prefillProperty)] : []}
            onSearch={onSearchProperties}
            onValueChange={handlePropertyChange}
          />
          <Link href="/app/portfoyler/yeni" className="mt-1 inline-block text-xs font-semibold text-brand-600 underline underline-offset-2">
            Yeni portföy ekle
          </Link>
        </FormField>
        <FormField label="Müşteri (opsiyonel)" htmlFor="offer-customer" inject={false} className="sm:col-span-2">
          <Combobox
            id="offer-customer"
            name="customer_id"
            aria-label="Müşteri"
            placeholder="— Müşteri seçin —"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            defaultValue={prefillCustomer?.id ?? ""}
            options={prefillCustomer ? [{ value: prefillCustomer.id, label: prefillCustomer.full_name }] : []}
            onSearch={onSearchCustomers}
            onValueChange={handleCustomerChange}
          />
        </FormField>
      </>
    ),
    kosullar: (
      <>
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
          <FormTextarea name="notes" rows={4} placeholder="Teklif koşulları, özel notlar…" />
        </FormField>
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const prop = pickedProperty && pickedProperty.id === values.property_id ? pickedProperty : null;
    const cust = pickedCustomer && pickedCustomer.id === values.customer_id ? pickedCustomer : null;
    const amount = parseLooseNumber(values.amount);
    const list = prop?.list_price ?? null;
    const ratio = amount != null && amount > 0 && list ? Math.round((amount / list) * 1000) / 10 : null;
    const validUntil = (values.valid_until ?? "").trim();
    const notes = (values.notes ?? "").trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-ink-950">
            {prop ? (prop.title ?? "Başlıksız portföy") : "Portföy seçilmedi"}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-muted">{prop ? prop.property_code : "Taraflar sekmesinden seçin"}</p>
          <p className="numeric mt-2 text-lg font-semibold text-ink-950">
            {amount != null && amount > 0 ? formatTry(amount) : "Tutar girilmedi"}
          </p>
        </div>
        <SummaryGroup title="Teklif">
          <SummaryRow label="Portföy" value={prop?.property_code ?? display.property_id ?? "Zorunlu"} muted={!prop && !display.property_id} tab="taraflar" field="property_id" />
          <SummaryRow label="Müşteri" value={cust?.full_name ?? display.customer_id ?? "Seçilmedi"} muted={!cust && !display.customer_id} tab="taraflar" field="customer_id" />
          <SummaryRow label="Liste fiyatı" value={list ? formatTry(list) : "Portföy seçilince"} muted={!list} tab="taraflar" field="property_id" />
          <SummaryRow label="Teklif tutarı" value={amount != null && amount > 0 ? formatTry(amount) : "Zorunlu"} muted={!(amount != null && amount > 0)} tab="kosullar" field="amount" />
          <SummaryRow
            label="Liste fiyatına oran"
            value={ratio != null ? `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(ratio)}` : "Tutar ve portföy girilince"}
            muted={ratio == null}
            tab="kosullar"
            field="amount"
          />
          <SummaryRow
            label="Geçerlilik"
            value={validUntil ? validUntil.split("-").reverse().join(".") : "Süresiz"}
            muted={!validUntil}
            tab="kosullar"
            field="valid_until"
          />
          <SummaryRow label="Not" value={notes || "Girilmedi"} muted={!notes} tab="kosullar" field="notes" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
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
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: OFFER_FORM_ID, fields: [...OFFER_DRAFT_FIELDS] }}
    />
  );
}
