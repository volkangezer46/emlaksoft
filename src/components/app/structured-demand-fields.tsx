"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { GeoSelect } from "@/components/app/geo-select";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { FACADE_OPTIONS, HEATING_OPTIONS } from "@/app/app/portfoyler/yeni/property-options";
import {
  CRITERIA_LABELS,
  MAX_EXTRA_LOCATIONS,
  MAX_FEATURE_TAGS,
  type CriteriaKey,
  type DemandLocation,
} from "@/lib/demand-criteria";

/**
 * Yapılandırılmış talep alanları — müşteri formu (talep sekmesi) ve talep formu (üç sekme)
 * TEK bileşeni paylaşır (mükerrer form yok). Alan adları `src/lib/demand-criteria.ts`
 * DEMAND_FIELD_GROUPS ile birebir; `form-tabs-contract.test.ts` bu dosyayı kaynak olarak okur.
 *
 * Çoklu değerler tek bir gizli alanda taşınır (sekme özeti `FormData.get` ile okur):
 * `required_keys` (virgüllü), `extra_locations` (JSON). Tanımlar (işlem/tür/aciliyet) props ile
 * `definitions` kaynağından gelir; ısınma/cephe portföy formundaki aynı sabitlerdir.
 */

type Option = { value: string; label: string };
type Province = { id: string; name: string };

export type DemandRequiredState = {
  required: ReadonlySet<CriteriaKey>;
  toggle: (key: CriteriaKey) => void;
};

/** "Olmazsa olmaz" işaretleri — formun bölümleri arasında paylaşılır (üst bileşende tutulur). */
export function useDemandRequired(): DemandRequiredState {
  const [keys, setKeys] = useState<CriteriaKey[]>([]);
  return {
    required: new Set(keys),
    toggle: (key) => setKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
  };
}

function RequiredToggle({ k, req }: { k: CriteriaKey; req: DemandRequiredState }) {
  const on = req.required.has(k);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => req.toggle(k)}
      title={on ? "Olmazsa olmaz: tutmayan portföyler eşleşmeden elenir" : "Tercih: skora katkı, eleme yok"}
      className={`focus-ring inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition ${
        on
          ? "border-brand-600 bg-brand-600/10 text-brand-700"
          : "border-line bg-canvas text-text-muted hover:border-brand-300"
      }`}
    >
      {on ? "Olmazsa olmaz" : "Tercih"}
    </button>
  );
}

/** Etiketin yanına "olmazsa olmaz / tercih" anahtarı koyar. */
function LabelWithToggle({ text, k, req }: { text: string; k: CriteriaKey; req: DemandRequiredState }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{text}</span>
      <RequiredToggle k={k} req={req} />
    </span>
  );
}

let extraRowSeq = 0;

function ExtraLocations({ provinces }: { provinces: Province[] }) {
  const [rows, setRows] = useState<Array<{ key: number } & Record<keyof DemandLocation, string>>>([]);
  const payload = JSON.stringify(
    rows.map((r) => ({
      province_id: r.province_id || null,
      district_id: r.district_id || null,
      neighborhood_id: r.neighborhood_id || null,
    })),
  );
  return (
    <div className="space-y-3">
      <input type="hidden" name="extra_locations" value={rows.length ? payload : ""} readOnly />
      {rows.map((row, i) => (
        <div key={row.key} className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-text-muted">Ek bölge {i + 1}</p>
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              className="focus-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-text-muted hover:text-danger-600"
              aria-label={`Ek bölge ${i + 1} kaldır`}
            >
              <X className="h-3 w-3" aria-hidden /> Kaldır
            </button>
          </div>
          <GeoSelect
            provinces={provinces}
            names={{
              province: `extra_loc_p_${row.key}`,
              district: `extra_loc_d_${row.key}`,
              neighborhood: `extra_loc_n_${row.key}`,
            }}
            onSelectionChange={(sel) =>
              setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...sel } : r)))
            }
          />
        </div>
      ))}
      {rows.length < MAX_EXTRA_LOCATIONS ? (
        <button
          type="button"
          onClick={() =>
            setRows((prev) => [...prev, { key: ++extraRowSeq, province_id: "", district_id: "", neighborhood_id: "" }])
          }
          className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Ek bölge ekle
        </button>
      ) : (
        <p className="text-xs text-text-faint">En fazla {MAX_EXTRA_LOCATIONS} ek bölge eklenebilir.</p>
      )}
    </div>
  );
}

export type StructuredDemandFieldsProps = {
  /** Hangi bölüm: "ne" (işlem/tür/aciliyet), "kriter" (bütçe ve özellikler), "bolge" (konum). */
  section: "ne" | "kriter" | "bolge";
  req: DemandRequiredState;
  transactionTypes: string[];
  propertyTypes: string[];
  urgencyOptions: Option[];
  provinces: Province[];
  defaultProvinceId?: string | null;
};

export function StructuredDemandFields({
  section,
  req,
  transactionTypes,
  propertyTypes,
  urgencyOptions,
  provinces,
  defaultProvinceId,
}: StructuredDemandFieldsProps) {
  if (section === "ne") {
    return (
      <>
        <input type="hidden" name="required_keys" value={[...req.required].join(",")} readOnly />
        <FormField label="İşlem türü" htmlFor="demand-tx" required>
          <FormSelect name="transaction_type" required defaultValue="Satılık">
            {transactionTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label={<LabelWithToggle text="Portföy türü" k="property_type" req={req} />} htmlFor="demand-type">
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
    );
  }

  if (section === "kriter") {
    return (
      <>
        <FormField
          label={
            <span className="inline-flex items-center gap-2">
              Bütçe min
              <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700">
                Girilince olmazsa olmaz
              </span>
            </span>
          }
          htmlFor="demand-budget-min"
        >
          <FormInput name="budget_min" inputMode="decimal" placeholder="5.000.000" />
        </FormField>
        <FormField label="Bütçe max" htmlFor="demand-budget-max">
          <FormInput name="budget_max" inputMode="decimal" placeholder="7.500.000" />
        </FormField>
        <FormField label={<LabelWithToggle text="Oda" k="rooms" req={req} />} htmlFor="demand-rooms">
          <FormInput name="rooms" placeholder="3+1" />
        </FormField>
        <FormField label={<LabelWithToggle text="Min m²" k="sqm" req={req} />} htmlFor="demand-sqm">
          <FormInput name="min_sqm" inputMode="decimal" placeholder="120" />
        </FormField>
        <FormField label="Max m²" htmlFor="demand-max-sqm" hint="Boş bırakılırsa üst sınır yok.">
          <FormInput name="max_sqm" inputMode="decimal" placeholder="200" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={<LabelWithToggle text="Kat min" k="floor" req={req} />} htmlFor="demand-floor-min">
            <FormInput name="floor_min" inputMode="numeric" placeholder="2" />
          </FormField>
          <FormField label="Kat max" htmlFor="demand-floor-max">
            <FormInput name="floor_max" inputMode="numeric" placeholder="8" />
          </FormField>
        </div>
        <FormField label={<LabelWithToggle text="Isınma" k="heating" req={req} />} htmlFor="demand-heating">
          <FormSelect name="heating" defaultValue="">
            <option value="">Fark etmez</option>
            {HEATING_OPTIONS.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label={<LabelWithToggle text="Cephe" k="facade" req={req} />} htmlFor="demand-facade">
          <FormSelect name="facade" defaultValue="">
            <option value="">Fark etmez</option>
            {FACADE_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField
          label={<LabelWithToggle text={CRITERIA_LABELS.features} k="features" req={req} />}
          htmlFor="demand-tags"
          className="sm:col-span-2"
          hint={`Virgülle ayırın (en fazla ${MAX_FEATURE_TAGS}). Örn. asansör, otopark, balkon. Portföyde etiket verisi yoksa eşleştirmede "belirsiz" sayılır.`}
        >
          <FormInput name="feature_tags" placeholder="asansör, otopark, balkon" maxLength={400} />
        </FormField>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-ink-950">
            <input type="checkbox" name="uses_loan" value="1" className="h-4 w-4 accent-[var(--brand-600)]" />
            Kredi kullanacak
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink-950">
            <input type="checkbox" name="swap_ok" value="1" className="h-4 w-4 accent-[var(--brand-600)]" />
            Takas olabilir
          </label>
          <span className="text-xs text-text-faint">Kredi ve takas not olarak saklanır; portföy verisi olmadığından skora katılmaz.</span>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-950">Konum</span>
        <RequiredToggle k="location" req={req} />
      </div>
      <GeoSelect
        provinces={provinces}
        defaultProvinceId={defaultProvinceId}
        names={{
          province: "demand_province_id",
          district: "demand_district_id",
          neighborhood: "demand_neighborhood_id",
        }}
      />
      <ExtraLocations provinces={provinces} />
    </div>
  );
}
