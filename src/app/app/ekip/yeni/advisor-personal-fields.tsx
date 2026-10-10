"use client";

import { type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";

import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { GeoSelect } from "@/components/app/geo-select";
import { EMPLOYMENT_TYPES, WEEK_DAYS, type PrivateSummary, type WorkProfileRow } from "@/lib/advisor/advisor-profile";
import { PII_DISABLED_MESSAGE } from "@/lib/advisor/pii-messages";

/**
 * Danışman profilinin "sonra doldurulur" alanları (kimlik/kişisel + istihdam/belgeler). Yeni danışman formunda YOK
 * (3 adım: Kimlik ve rol · Uzmanlık ve bölge · Davet); danışman detayındaki "Kişisel bilgiler" düzenleyicileri kullanır.
 * Ortak tipler/yardımcılar `advisor-extra-fields` ile aynı kaynaktan gelir.
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

