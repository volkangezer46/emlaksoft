"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Tag, Users } from "lucide-react";
import { createOffer } from "@/app/actions/offers";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
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

type PropertyOption = { id: string; property_code: string; title: string | null; list_price: number | null };
type CustomerOption = { id: string; full_name: string };

const formatTl = (value: number) => new Intl.NumberFormat("tr-TR").format(value);

const TAB_ICONS = { taraflar: Users, kosullar: ClipboardList } as const;

const FIELD_LABELS = { property_id: "Portföy", amount: "Teklif tutarı" };

export function NewOfferForm({
  properties,
  customers,
  defaultPropertyId = null,
  defaultCustomerId = null,
  todayIso,
  userId,
}: {
  properties: PropertyOption[];
  customers: CustomerOption[];
  /** ?portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu. */
  defaultPropertyId?: string | null;
  /** ?musteri= — aynı kısayolun müşteri ön dolgusu. */
  defaultCustomerId?: string | null;
  /** Geçerlilik tarihi alt sınırı (sunucudan; bileşende saat okunmaz). */
  todayIso: string;
  userId: string;
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
          className="sm:col-span-2"
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
        <FormField label="Müşteri (opsiyonel)" htmlFor="offer-customer" className="sm:col-span-2">
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

  function renderSummary({ values }: TabbedSummaryContext) {
    const prop = properties.find((p) => p.id === values.property_id);
    const cust = customers.find((c) => c.id === values.customer_id);
    const amount = parseLooseNumber(values.amount);
    const list = prop?.list_price ?? null;
    const ratio = amount != null && amount > 0 && list ? Math.round((amount / list) * 1000) / 10 : null;
    const validUntil = (values.valid_until ?? "").trim();
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
          <SummaryRow label="Portföy" value={prop?.property_code ?? "Zorunlu"} muted={!prop} tab="taraflar" field="property_id" />
          <SummaryRow label="Müşteri" value={cust?.full_name ?? "Seçilmedi"} muted={!cust} tab="taraflar" field="customer_id" />
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
