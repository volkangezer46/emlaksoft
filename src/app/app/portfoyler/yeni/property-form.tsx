"use client";

import { CustomFieldInputs, type CustomFieldInputDef } from "@/components/app/custom-field-inputs";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { takeSubmitIntent } from "@/lib/form-submit-intent";
import { createProperty } from "@/app/actions/properties";
import { DuplicateHint } from "@/components/app/duplicate-hint";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { FormField, FormInput, FormSelect, fieldClass } from "@/components/ui/form-controls";
import { LatLngPicker } from "@/components/app/lat-lng-picker";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { clearFormDraft } from "@/components/app/use-form-draft";
import { commissionSummary, parseLooseNumber } from "@/lib/form-tabs";
import { formatTry } from "@/lib/utils";
import { evaluateOwnerInfo, parseOwnerInfoForm } from "@/lib/property-owner/info";
import { OwnerInfoSection } from "./owner-info-section";
import { FACADE_OPTIONS, HEATING_OPTIONS } from "./property-options";
import { PROPERTY_DRAFT_FIELDS, PROPERTY_FORM_ID, PROPERTY_TABS } from "./property-tabs";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const TAB_ICONS = {
  temel: TI.temel,
  konum: TI.konum,
  fiyat: TI.fiyat,
  ozellikler: TI.ozellikler,
  sahip: TI.taraflar,
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
  poolEnabled = false,
  customFields = [],
}: {
  /** Ofisin etkin özel alanları (yeni kayıtta girilir; doğrulama/yazım sunucuda). */
  customFields?: CustomFieldInputDef[];
  provinces: Province[];
  branches: Branch[];
  propertyTypes: string[];
  transactionTypes: string[];
  userId: string;
  poolEnabled?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const intent = takeSubmitIntent();
    const result = await createProperty(formData);
    if (result.ok) {
      clearFormDraft(userId, PROPERTY_FORM_ID);
      if (result.authorityWarning) push(result.authorityWarning, "info");
      if (result.pooled) push("Portföy taslak olarak oluşturuldu ve ilan havuzuna gönderildi", "ok");
      else if (result.ownerMissing && result.ownerMissing.length > 0) {
        push(`Portföy taslak olarak oluşturuldu. İlan sahibi bilgisi %${result.ownerInfoScore ?? 0} tamam: yayın için ${result.ownerMissing.length} eksik var`, "info");
      } else push("Portföy taslak olarak oluşturuldu", "ok");
      if (intent === "new") {
        // "Kaydet ve yenisini ekle": aynı sayfa temiz açılsın — tam yükleme.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- bilinçli tam yükleme: form durumu sıfırlanır
        window.location.assign(`${window.location.pathname}?kaydedildi=1`);
        return;
      }
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
    sahip: <OwnerInfoSection poolEnabled={poolEnabled} />,
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const price = parseLooseNumber(values.list_price);
    const rate = parseLooseNumber(values.commission_rate);
    const sqm = parseLooseNumber(values.sqm);
    const calc = commissionSummary(values.list_price, values.commission_rate, values.sqm);
    const province = provinces.find((p) => p.id === values.province_id)?.name;
    const branch = branches.find((b) => b.id === values.branch_id)?.name;
    // Önizleme: seçilen mevcut müşterinin telefonu kayıtlıysa karşılanmış sayılır (sunucu kesin kararı verir).
    const owner = evaluateOwnerInfo({ ...parseOwnerInfoForm((n) => values[n]).value, existingOwnerHasPhone: true });
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
          <SummaryRow label="İlçe" value={display.district_id ?? "Seçilmedi"} muted={!display.district_id} tab="konum" field="district_id" />
          <SummaryRow label="Mahalle" value={display.neighborhood_id ?? "Seçilmedi"} muted={!display.neighborhood_id} tab="konum" field="neighborhood_id" />
          <SummaryRow label="Adres" value={(values.address_line ?? "").trim() || "Girilmedi"} muted={!(values.address_line ?? "").trim()} tab="konum" field="address_line" />
          {branches.length > 0 ? <SummaryRow label="Şube" value={branch ?? "Atanmadı"} muted={!branch} tab="temel" field="branch_id" /> : null}
        </SummaryGroup>
        <SummaryGroup title="İlan sahibi bilgi tamamlama">
          <SummaryRow label="Tamamlama" value={`%${owner.score}`} muted={!owner.complete} tab="sahip" />
          <SummaryRow
            label="Yayına alınabilir mi"
            value={owner.complete ? "Evet" : `Hayır · ${owner.missing.length} eksik`}
            muted={!owner.complete}
            tab="sahip"
          />
          {owner.missing.slice(0, 3).map((m) => (
            <SummaryRow key={m.key} label="Eksik" value={m.label} muted tab="sahip" />
          ))}
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
      notice={<DuplicateHint kind="property" />}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={{ ...tabPanels, temel: <>{tabPanels.temel}<CustomFieldInputs defs={customFields} /></> }}
      summary={renderSummary}
      saveAndNew
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: PROPERTY_FORM_ID, fields: [...PROPERTY_DRAFT_FIELDS] }}
    />
  );
}
