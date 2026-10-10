"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { GeoSelect } from "@/components/app/geo-select";
import { REGION_WEIGHTS, SPECIALTY_LEVELS, TRANSACTION_TYPES, type RegionRow, type RegionView, type SpecialtyOptions, type SpecialtyRow } from "@/lib/advisor/advisor-profile";


// Kişisel/istihdam alanları ayrı dosyada (yeni danışman formu bunları göstermez); mevcut içe aktarmalar çalışsın diye yeniden dışa aktarılır.
export { PersonalFields, EmploymentFields } from "./advisor-personal-fields";

/**
 * Danışman formunun yeni sekme alanları. Hem "Yeni danışman" formunda hem Danışman 360 düzenleyicilerinde
 * (ekip/[id]) kullanılır: alan adları ve kayıt biçimi tek yerde. İl/ilçe `GeoSelect`
 * (geo_* tablolarından). Tür/segment listeleri koda sabit değil: sunucu `definitions` tablosundan getirip verir.
 */

type GeoOption = { id: string; name: string };

// ---------------------------------------------------------------------------
// Uzmanlık (tür / segment x işlem türü x seviye x fiyat bandı)
// ---------------------------------------------------------------------------

type SpecRowState = {
  uid: number;
  kind: "property_type" | "segment";
  value: string;
  transaction_type: string;
  level: string;
  price_min: string;
  price_max: string;
  experience_years: string;
};

function toSpecState(rows: readonly SpecialtyRow[] | undefined): SpecRowState[] {
  return (rows ?? []).map((r, i) => ({
    uid: i + 1,
    kind: r.kind,
    value: r.value,
    transaction_type: r.transaction_type ?? "",
    level: String(r.level),
    price_min: r.price_min === null ? "" : String(r.price_min),
    price_max: r.price_max === null ? "" : String(r.price_max),
    experience_years: r.experience_years === null ? "" : String(r.experience_years),
  }));
}

export function SpecialtiesField({
  options,
  defaults,
}: {
  options: SpecialtyOptions;
  defaults?: readonly SpecialtyRow[];
}) {
  const [rows, setRows] = useState<SpecRowState[]>(() => toSpecState(defaults));
  const [nextUid, setNextUid] = useState(() => (defaults?.length ?? 0) + 1);

  const patch = (uid: number, p: Partial<SpecRowState>) => setRows((cur) => cur.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const add = () => {
    setRows((cur) => [
      ...cur,
      { uid: nextUid, kind: "property_type", value: "", transaction_type: "", level: "2", price_min: "", price_max: "", experience_years: "" },
    ]);
    setNextUid((n) => n + 1);
  };

  const json = JSON.stringify(
    rows
      .filter((r) => r.value)
      .map((r) => ({
        kind: r.kind,
        value: r.value,
        transaction_type: r.transaction_type || null,
        level: Number(r.level),
        price_min: r.price_min === "" ? null : r.price_min,
        price_max: r.price_max === "" ? null : r.price_max,
        experience_years: r.experience_years === "" ? null : r.experience_years,
      })),
  );

  return (
    <div className="space-y-3 sm:col-span-2">
      <input type="hidden" name="specialties_json" value={json} />
      <p className="text-xs text-text-muted">
        Tür portföy tiplerinden, segment ofisin tanımlarından gelir (Ayarlar &gt; Tanımlar). Atama ve ilan havuzu
        önerisi bu bilgiyi kullanır; satır yoksa danışman uzmanlıktan bağımsız değerlendirilir.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-4 text-center text-sm text-text-muted">
          Henüz uzmanlık eklenmedi. Örn. Arsa, Konut, Lüks konut, Yatırımlık, İşyeri.
        </p>
      ) : null}
      {rows.map((r) => {
        const list = r.kind === "property_type" ? options.propertyTypes : options.segments;
        return (
          <div key={r.uid} className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:grid-cols-6">
            <FormSelect aria-label="Uzmanlık grubu" value={r.kind} onChange={(e) => patch(r.uid, { kind: e.target.value as SpecRowState["kind"], value: "" })}>
              <option value="property_type">Portföy türü</option>
              <option value="segment">Segment</option>
            </FormSelect>
            <FormSelect aria-label="Uzmanlık" className="sm:col-span-2" value={r.value} onChange={(e) => patch(r.uid, { value: e.target.value })}>
              <option value="">Seçin</option>
              {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </FormSelect>
            <FormSelect aria-label="İşlem türü" value={r.transaction_type} onChange={(e) => patch(r.uid, { transaction_type: e.target.value })}>
              <option value="">Satılık ve kiralık</option>
              {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </FormSelect>
            <FormSelect aria-label="Seviye" value={r.level} onChange={(e) => patch(r.uid, { level: e.target.value })}>
              {SPECIALTY_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </FormSelect>
            <FormInput aria-label="En düşük fiyat (₺)" type="number" min={0} step={1000} inputMode="decimal" placeholder="En az ₺" value={r.price_min} onChange={(e) => patch(r.uid, { price_min: e.target.value })} />
            <FormInput aria-label="En yüksek fiyat (₺)" type="number" min={0} step={1000} inputMode="decimal" placeholder="En çok ₺" value={r.price_max} onChange={(e) => patch(r.uid, { price_max: e.target.value })} />
            <FormInput aria-label="Deneyim (yıl)" type="number" min={0} max={60} step={1} inputMode="numeric" placeholder="Deneyim (yıl)" value={r.experience_years} onChange={(e) => patch(r.uid, { experience_years: e.target.value })} />
            <div className="sm:col-span-3 sm:text-right">
              <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={() => setRows((cur) => cur.filter((x) => x.uid !== r.uid))}>
                Satırı kaldır
              </Button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={add}>Uzmanlık ekle</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bölgeler (il > ilçe > mahalle x ağırlık)
// ---------------------------------------------------------------------------

type RegionRowState = {
  uid: number;
  province_id: string;
  district_id: string;
  neighborhood_id: string;
  weight: string;
  defaultProvince: string | null;
  defaultDistrict: string | null;
  defaultNeighborhood: string | null;
};

function toRegionState(rows: readonly (RegionRow | RegionView)[] | undefined): RegionRowState[] {
  return (rows ?? []).map((r, i) => ({
    uid: i + 1,
    province_id: r.province_id,
    district_id: r.district_id ?? "",
    neighborhood_id: r.neighborhood_id ?? "",
    weight: String(r.weight),
    defaultProvince: r.province_id,
    defaultDistrict: r.district_id,
    defaultNeighborhood: r.neighborhood_id,
  }));
}

export function RegionsField({
  provinces,
  defaults,
}: {
  provinces: GeoOption[];
  defaults?: readonly (RegionRow | RegionView)[];
}) {
  const [rows, setRows] = useState<RegionRowState[]>(() => toRegionState(defaults));
  const [nextUid, setNextUid] = useState(() => (defaults?.length ?? 0) + 1);

  const patch = (uid: number, p: Partial<RegionRowState>) => setRows((cur) => cur.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const add = () => {
    setRows((cur) => [
      ...cur,
      { uid: nextUid, province_id: "", district_id: "", neighborhood_id: "", weight: "3", defaultProvince: null, defaultDistrict: null, defaultNeighborhood: null },
    ]);
    setNextUid((n) => n + 1);
  };

  const json = JSON.stringify(
    rows
      .filter((r) => r.province_id)
      .map((r) => ({
        province_id: r.province_id,
        district_id: r.district_id || null,
        neighborhood_id: r.neighborhood_id || null,
        weight: Number(r.weight),
      })),
  );

  return (
    <div className="space-y-3 sm:col-span-2">
      <input type="hidden" name="regions_json" value={json} />
      <p className="text-xs text-text-muted">
        İl, ilçe ve isteğe bağlı mahalle seçin (örn. İstanbul &gt; Kadıköy). Ağırlık 5 danışmanın ana bölgesi,
        1 az bildiği bölgedir; ilan havuzu önerisi ağırlığı kullanır.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-4 text-center text-sm text-text-muted">
          Henüz bölge eklenmedi.
        </p>
      ) : null}
      {rows.map((r) => (
        <div key={r.uid} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
          <GeoSelect
            provinces={provinces}
            names={{ province: `rgn_p_${r.uid}`, district: `rgn_d_${r.uid}`, neighborhood: `rgn_n_${r.uid}` }}
            defaultProvinceId={r.defaultProvince}
            defaultDistrictId={r.defaultDistrict}
            defaultNeighborhoodId={r.defaultNeighborhood}
            onSelectionChange={(sel) => patch(r.uid, sel)}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <FormField label="Ağırlık" htmlFor={`rgn-w-${r.uid}`}>
              <FormSelect id={`rgn-w-${r.uid}`} value={r.weight} onChange={(e) => patch(r.uid, { weight: e.target.value })}>
                {REGION_WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </FormSelect>
            </FormField>
            <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={() => setRows((cur) => cur.filter((x) => x.uid !== r.uid))}>
              Bölgeyi kaldır
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={add}>Bölge ekle</Button>
    </div>
  );
}
