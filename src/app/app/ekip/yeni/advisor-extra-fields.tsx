"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { GeoSelect } from "@/components/app/geo-select";
import {
  EMPLOYMENT_TYPES,
  REGION_WEIGHTS,
  SPECIALTY_LEVELS,
  TRANSACTION_TYPES,
  WEEK_DAYS,
  type PrivateSummary,
  type RegionRow,
  type RegionView,
  type SpecialtyOptions,
  type SpecialtyRow,
  type WorkProfileRow,
} from "@/lib/advisor/advisor-profile";
import { PII_DISABLED_MESSAGE } from "@/lib/advisor/pii-messages";

/**
 * Danışman formunun yeni sekme alanları. Hem "Yeni danışman" formunda hem Danışman 360 düzenleyicilerinde
 * (ekip/[id]) kullanılır: alan adları ve kayıt biçimi tek yerde. Telefon `PhoneInput`; il/ilçe `GeoSelect`
 * (geo_* tablolarından). Tür/segment listeleri koda sabit değil: sunucu `definitions` tablosundan getirip verir.
 */

type GeoOption = { id: string; name: string };

// ---------------------------------------------------------------------------
// Kimlik ve kişisel
// ---------------------------------------------------------------------------

export function PersonalFields({
  provinces,
  piiEnabled,
  defaults,
  tcExtra,
  ibanExtra,
}: {
  provinces: GeoOption[];
  piiEnabled: boolean;
  defaults?: PrivateSummary | null;
  /** Düzenleyicide maskeli değer + "Göster" gibi ek içerik. */
  tcExtra?: ReactNode;
  ibanExtra?: ReactNode;
}) {
  return (
    <>
      {piiEnabled ? null : (
        <div className="sm:col-span-2">
          <Alert tone="warning" title={PII_DISABLED_MESSAGE}>
            TC kimlik no ve IBAN alanları kapalı: şifreleme anahtarı (ADVISOR_PII_KEY) tanımlanana kadar bu iki değer
            kaydedilmez ve hiçbir yere açık yazılmaz. Diğer kişisel alanlar kullanılabilir.
          </Alert>
        </div>
      )}
      <FormField
        label="TC kimlik no"
        htmlFor="adv-tc"
        hint="Yalnız sunucuda şifreli saklanır; ekranda son 4 hane görünür."
      >
        <FormInput
          id="adv-tc"
          name="national_id"
          inputMode="numeric"
          maxLength={11}
          autoComplete="off"
          placeholder={piiEnabled ? (defaults?.national_id_last4 ? "Değiştirmek için yeni numara yazın" : "11 haneli TC kimlik no") : "Etkin değil"}
          disabled={!piiEnabled}
        />
        {tcExtra}
      </FormField>
      <FormField label="Doğum tarihi" htmlFor="adv-birth">
        <FormInput id="adv-birth" name="birth_date" type="date" defaultValue={defaults?.birth_date ?? ""} />
      </FormField>
      <FormField label="Adres" htmlFor="adv-addr" className="sm:col-span-2">
        <FormInput id="adv-addr" name="address_line" maxLength={400} autoComplete="off" defaultValue={defaults?.address_line ?? ""} placeholder="Mahalle, cadde, no" />
      </FormField>
      <div className="sm:col-span-2">
        <GeoSelect
          provinces={provinces}
          withNeighborhood={false}
          names={{ province: "private_province_id", district: "private_district_id" }}
          defaultProvinceId={defaults?.province_id}
          defaultDistrictId={defaults?.district_id}
        />
      </div>
      <FormField label="Acil durumda aranacak kişi" htmlFor="adv-em-name">
        <FormInput id="adv-em-name" name="emergency_name" maxLength={120} autoComplete="off" defaultValue={defaults?.emergency_name ?? ""} />
      </FormField>
      <FormField label="Yakınlık" htmlFor="adv-em-rel" hint="Örn. eş, anne, kardeş.">
        <FormInput id="adv-em-rel" name="emergency_relation" maxLength={60} autoComplete="off" defaultValue={defaults?.emergency_relation ?? ""} />
      </FormField>
      <FormField label="Acil durum telefonu" htmlFor="adv-em-phone">
        <PhoneInput id="adv-em-phone" name="emergency_phone" defaultValue={defaults?.emergency_phone ?? ""} />
      </FormField>
      <FormField label="Banka adı" htmlFor="adv-bank">
        <FormInput id="adv-bank" name="bank_name" maxLength={80} autoComplete="off" defaultValue={defaults?.bank_name ?? ""} />
      </FormField>
      <FormField label="IBAN sahibi" htmlFor="adv-iban-holder">
        <FormInput id="adv-iban-holder" name="iban_holder" maxLength={120} autoComplete="off" defaultValue={defaults?.iban_holder ?? ""} />
      </FormField>
      <FormField label="IBAN" htmlFor="adv-iban" hint="Yalnız sunucuda şifreli saklanır; ekranda son 4 hane görünür.">
        <FormInput
          id="adv-iban"
          name="iban"
          maxLength={34}
          autoComplete="off"
          placeholder={piiEnabled ? (defaults?.iban_last4 ? "Değiştirmek için yeni IBAN yazın" : "TR00 0000 0000 0000 0000 0000 00") : "Etkin değil"}
          disabled={!piiEnabled}
        />
        {ibanExtra}
      </FormField>
    </>
  );
}

// ---------------------------------------------------------------------------
// İstihdam ve belgeler
// ---------------------------------------------------------------------------

function dayPart(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

export function EmploymentFields({ defaults }: { defaults?: WorkProfileRow | null }) {
  const days = defaults?.work_days ?? [1, 2, 3, 4, 5];
  return (
    <>
      <FormField label="İstihdam türü" htmlFor="adv-emp">
        <FormSelect id="adv-emp" name="employment_type" defaultValue={defaults?.employment_type ?? ""}>
          <option value="">Seçilmedi</option>
          {EMPLOYMENT_TYPES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="İşe giriş tarihi" htmlFor="adv-hired">
        <FormInput id="adv-hired" name="hired_at" type="date" defaultValue={dayPart(defaults?.hired_at)} />
      </FormField>
      <FormField label="Ayrılış tarihi" htmlFor="adv-left" hint="Yalnız işten ayrılan danışman için.">
        <FormInput id="adv-left" name="left_at" type="date" defaultValue={dayPart(defaults?.left_at)} />
      </FormField>
      <div className="hidden sm:block" aria-hidden />
      <FormField label="Taşınmaz Ticareti Yetki Belgesi no" htmlFor="adv-auth-no">
        <FormInput id="adv-auth-no" name="authority_cert_no" maxLength={64} autoComplete="off" defaultValue={defaults?.authority_cert_no ?? ""} />
      </FormField>
      <FormField label="Yetki belgesi bitiş tarihi" htmlFor="adv-auth-exp" hint="Bitişe 30 ve 7 gün kala ofis sahibine uyarı görünür.">
        <FormInput id="adv-auth-exp" name="authority_cert_expires_on" type="date" defaultValue={dayPart(defaults?.authority_cert_expires_on)} />
      </FormField>
      <FormField label="SPK belge no" htmlFor="adv-spk-no">
        <FormInput id="adv-spk-no" name="spk_cert_no" maxLength={64} autoComplete="off" defaultValue={defaults?.spk_cert_no ?? ""} />
      </FormField>
      <FormField label="SPK belgesi bitiş tarihi" htmlFor="adv-spk-exp">
        <FormInput id="adv-spk-exp" name="spk_cert_expires_on" type="date" defaultValue={dayPart(defaults?.spk_cert_expires_on)} />
      </FormField>
      <FormField label="Aktif ilan üst sınırı" htmlFor="adv-max-list" hint="Boş: sınırsız. İlan havuzu atamasında kapasite olarak kullanılır.">
        <FormInput id="adv-max-list" name="max_active_listings" type="number" min={0} max={10000} step={1} inputMode="numeric" defaultValue={defaults?.max_active_listings ?? ""} />
      </FormField>
      <FormField label="Aktif talep üst sınırı" htmlFor="adv-max-dem" hint="Boş: sınırsız.">
        <FormInput id="adv-max-dem" name="max_active_demands" type="number" min={0} max={10000} step={1} inputMode="numeric" defaultValue={defaults?.max_active_demands ?? ""} />
      </FormField>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-ink-950">Çalışma günleri</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK_DAYS.map((d) => (
            <label key={d.n} className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-600/5">
              <input type="checkbox" name="work_days" value={d.n} defaultChecked={days.includes(d.n)} className="accent-[var(--brand-600)]" />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Mesai başlangıcı" htmlFor="adv-ws">
        <FormInput id="adv-ws" name="work_start" type="time" defaultValue={defaults?.work_start?.slice(0, 5) ?? ""} />
      </FormField>
      <FormField label="Mesai bitişi" htmlFor="adv-we">
        <FormInput id="adv-we" name="work_end" type="time" defaultValue={defaults?.work_end?.slice(0, 5) ?? ""} />
      </FormField>
      <FormField label="İlan havuzuna kabul" htmlFor="adv-pool">
        <FormSelect id="adv-pool" name="accepts_pool" defaultValue={defaults && !defaults.accepts_pool ? "0" : "1"}>
          <option value="1">Havuzdan ilan/talep alır</option>
          <option value="0">Havuza kapalı</option>
        </FormSelect>
      </FormField>
      <FormField label="Havuzu şu tarihe kadar duraklat" htmlFor="adv-pause" hint="İzin, tatil gibi dönemlerde. Boş: duraklatma yok.">
        <FormInput id="adv-pause" name="pool_paused_until" type="date" defaultValue={dayPart(defaults?.pool_paused_until)} />
      </FormField>
    </>
  );
}

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
            <FormInput aria-label="En düşük fiyat (TL)" type="number" min={0} step={1000} inputMode="decimal" placeholder="En az TL" value={r.price_min} onChange={(e) => patch(r.uid, { price_min: e.target.value })} />
            <FormInput aria-label="En yüksek fiyat (TL)" type="number" min={0} step={1000} inputMode="decimal" placeholder="En çok TL" value={r.price_max} onChange={(e) => patch(r.uid, { price_max: e.target.value })} />
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
        İl, ilçe ve isteğe bağlı mahalle seçin (örn. Kahramanmaraş &gt; Onikişubat). Ağırlık 5 danışmanın ana bölgesi,
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
