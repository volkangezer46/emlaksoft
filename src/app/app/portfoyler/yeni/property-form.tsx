"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createProperty } from "@/app/actions/properties";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { FormField, FormInput, FormSelect, fieldClass } from "@/components/ui/form-controls";
import { LatLngPicker } from "@/components/app/lat-lng-picker";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { clearFormDraft } from "@/components/app/use-form-draft";
import { commissionSummary, parseLooseNumber } from "@/lib/form-tabs";
import { formatTry } from "@/lib/utils";
import { FACADE_OPTIONS, HEATING_OPTIONS } from "./property-options";
import { PROPERTY_DRAFT_FIELDS, PROPERTY_FORM_ID, PROPERTY_TABS } from "./property-tabs";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const TAB_ICONS = {
  temel: TI.temel,
  konum: TI.konum,
  fiyat: TI.fiyat,
  ozellikler: TI.ozellikler,
  ek: TI.ek,
} as const;

const FIELD_LABELS = {
  title: "Portföy başlığı",
  transaction_type: "İşlem türü",
  property_type: "Portföy türü",
  list_price: "Liste fiyatı",
  commission_rate: "Komisyon oranı",
};

function SelectField({
  id,
  name,
  label,
  required,
  defaultValue,
  children,
  className,
}: {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  defaultValue: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <FormField label={label} htmlFor={id} required={required} inject={false} className={className}>
      <div className="relative">
        <FormSelect id={id} name={name} required={required} aria-required={required || undefined} defaultValue={defaultValue} className="appearance-none">
          {children}
        </FormSelect>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
      </div>
    </FormField>
  );
}

const formatNumber = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);

export function PropertyForm({
  provinces,
  branches,
  propertyTypes,
  transactionTypes,
  userId,
}: {
  provinces: Province[];
  branches: Branch[];
  propertyTypes: string[];
  transactionTypes: string[];
  userId: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createProperty(formData);
    if (result.ok) {
      clearFormDraft(userId, PROPERTY_FORM_ID);
      push("Portföy taslak olarak oluşturuldu", "ok");
      router.push("/app/portfoyler");
      return;
    }
    setPending(false);
    setError(result.error ?? "Portföy eklenemedi.");
  }

  // `<form action>` başarısızlıkta alanları sıfırlıyordu; onSubmit kullanıcının yazdıklarını korur.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(new FormData(event.currentTarget));
  }

  const tabs: FormTab[] = useMemo(
    () =>
      PROPERTY_TABS.map((t) => ({
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
    temel: (
      <>
        <FormField label="Portföy başlığı" htmlFor="property-title" required className="sm:col-span-2">
          <FormInput name="title" required placeholder="Örn. Onikişubat Tekerek 4+1" />
        </FormField>
        <SelectField id="transaction-type" name="transaction_type" label="İşlem türü" required defaultValue="Satılık">
          {transactionTypes.map((type) => <option key={type}>{type}</option>)}
        </SelectField>
        <SelectField id="property-type" name="property_type" label="Portföy türü" required defaultValue="Daire">
          {propertyTypes.map((type) => <option key={type}>{type}</option>)}
        </SelectField>
        <FormField label="Oda" htmlFor="rooms">
          <FormInput name="rooms" placeholder="4+1" />
        </FormField>
        <FormField label="Brüt m²" htmlFor="sqm">
          <FormInput name="sqm" inputMode="decimal" placeholder="185" />
        </FormField>
        {branches.length > 0 ? (
          <SelectField id="property-branch" name="branch_id" label="Şube" defaultValue="" className="sm:col-span-2">
            <option value="">Şube atanmadı</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </SelectField>
        ) : null}
      </>
    ),
    konum: (
      <>
        {/* İl/İlçe/Mahalle: emsal motoru (find_comparables) ilçe üzerinden çalışır. */}
        <GeoSelect provinces={provinces} className="sm:col-span-2" />
        <FormField label="Adres özeti" htmlFor="address-line" className="sm:col-span-2">
          <FormInput name="address_line" placeholder="Cadde, sokak, kapı no…" />
        </FormField>
        <LatLngPicker fieldClass={fieldClass} />
      </>
    ),
    fiyat: (
      <>
        <FormField label="Liste fiyatı" htmlFor="list-price" required>
          <FormInput name="list_price" required inputMode="decimal" placeholder="6.750.000" />
        </FormField>
        <FormField label="Komisyon oranı (%)" htmlFor="commission-rate" required>
          <FormInput name="commission_rate" required inputMode="decimal" min="0.01" max="100" step="0.01" placeholder="3" />
        </FormField>
      </>
    ),
    ozellikler: (
      <>
        {/* features jsonb'ye portal/broşürle AYNI anahtarlarla yazılır (floor, heating, building_age, facade) + tapu ada/parsel. */}
        <FormField label="Bulunduğu kat" htmlFor="floor">
          <FormInput name="floor" inputMode="numeric" placeholder="Örn. 3 (bodrum için -1)" />
        </FormField>
        <SelectField id="heating" name="heating" label="Isınma" defaultValue="">
          <option value="">Seçilmedi</option>
          {HEATING_OPTIONS.map((h) => <option key={h}>{h}</option>)}
        </SelectField>
        <FormField label="Bina yaşı" htmlFor="building-age">
          <FormInput name="building_age" inputMode="numeric" placeholder="Örn. 5" />
        </FormField>
        <SelectField id="facade" name="facade" label="Cephe (ops.)" defaultValue="">
          <option value="">Seçilmedi</option>
          {FACADE_OPTIONS.map((f) => <option key={f}>{f}</option>)}
        </SelectField>
        <FormField label="Tapu — Ada" htmlFor="parcel-block">
          <FormInput name="parcel_block" placeholder="Örn. 1234" />
        </FormField>
        <FormField label="Tapu — Parsel" htmlFor="parcel-lot">
          <FormInput name="parcel_lot" placeholder="Örn. 56" />
        </FormField>
      </>
    ),
    ek: (
      <div className="sm:col-span-2">
        <p className="text-sm text-text-muted">
          Portföy <strong className="font-semibold text-ink-950">taslak</strong> olarak açılır. Kaydettikten sonra detay sayfasında şunları tamamlarsınız:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-ink-950">
          {["Fotoğraflar ve ilan açıklaması", "Fiyat sağlığı (emsal karşılaştırması)", "Portal ve vitrin yayını"].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-700">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const price = parseLooseNumber(values.list_price);
    const rate = parseLooseNumber(values.commission_rate);
    const sqm = parseLooseNumber(values.sqm);
    const calc = commissionSummary(values.list_price, values.commission_rate, values.sqm);
    const province = provinces.find((p) => p.id === values.province_id)?.name;
    const branch = branches.find((b) => b.id === values.branch_id)?.name;
    const chips = [values.transaction_type, values.property_type, (values.rooms ?? "").trim(), sqm ? `${formatNumber(sqm)} m²` : ""].filter(Boolean);
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-ink-950">{title || "Portföy başlığı girilmedi"}</p>
          {chips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c} className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-medium text-brand-700">{c}</span>
              ))}
            </div>
          ) : null}
          <p className="numeric mt-3 text-lg font-semibold text-ink-950">{price != null && price > 0 ? formatTry(price) : "Fiyat girilmedi"}</p>
        </div>
        <SummaryGroup title="Fiyat ve komisyon">
          <SummaryRow label="Liste fiyatı" value={price != null && price > 0 ? formatTry(price) : "Zorunlu"} muted={!(price != null && price > 0)} tab="fiyat" field="list_price" />
          <SummaryRow label="Komisyon oranı" value={rate != null && rate > 0 ? `%${formatNumber(rate)}` : "Zorunlu"} muted={!(rate != null && rate > 0)} tab="fiyat" field="commission_rate" />
          <SummaryRow label="Tahmini komisyon" value={calc ? formatTry(calc.amount) : "Fiyat ve oran girilince"} muted={!calc} tab="fiyat" field="list_price" />
          <SummaryRow label="m² birim fiyatı" value={calc?.perSqm ? formatTry(calc.perSqm) : "Fiyat ve m² girilince"} muted={!calc?.perSqm} tab="temel" field="sqm" />
        </SummaryGroup>
        <SummaryGroup title="Konum">
          <SummaryRow label="İl" value={province ?? "Seçilmedi"} muted={!province} tab="konum" />
          {branches.length > 0 ? <SummaryRow label="Şube" value={branch ?? "Atanmadı"} muted={!branch} tab="temel" field="branch_id" /> : null}
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni portföy oluştur"
      description="Temel bilgilerle taslak portföy açın."
      breadcrumbs={[{ label: "Portföyler", href: "/app/portfoyler" }, { label: "Yeni" }]}
      cancelHref="/app/portfoyler"
      submitLabel="Portföyü oluştur"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: PROPERTY_FORM_ID, fields: [...PROPERTY_DRAFT_FIELDS] }}
    />
  );
}
