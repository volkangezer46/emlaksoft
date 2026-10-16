"use client";

import { useState } from "react";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";
import { PersonSelect } from "@/components/ui/person-select";
import { RECRUIT_SOURCES, RECRUIT_SOURCE_LABEL } from "@/lib/recruiting/logic";

export type CandidateDefaults = {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  source?: string;
  owner_id?: string | null;
  experience_years?: number | null;
  current_office?: string | null;
  message?: string | null;
};

export type MemberOption = { id: string; name: string };

/**
 * Aday bilgi alanları (yeni aday + düzenle aynı gövde). Telefon `PhoneInput`, e-posta `EmailInput`; sunucu
 * `parsePhoneStrict` ile yeniden doğrular. Mobilde tek sütun, sm+ iki sütun.
 */
export function CandidateFields({ prefix, defaults, members }: { prefix: string; defaults?: CandidateDefaults; members: MemberOption[] }) {
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Ad soyad" htmlFor={`${prefix}-name`} required className="sm:col-span-2">
        <FormInput id={`${prefix}-name`} name="full_name" required minLength={2} maxLength={160} autoComplete="off" defaultValue={defaults?.full_name ?? ""} placeholder="Örn. Ayşe Yıldız" />
      </FormField>
      <FormField label="Cep telefonu" htmlFor={`${prefix}-phone`} hint="Telefon ya da e-postadan biri yeterli.">
        <PhoneInput id={`${prefix}-phone`} name="phone" value={phone} onValueChange={setPhone} autoComplete="off" />
      </FormField>
      <FormField label="E-posta" htmlFor={`${prefix}-email`}>
        <EmailInput id={`${prefix}-email`} name="email" defaultValue={defaults?.email ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Kaynak" htmlFor={`${prefix}-source`}>
        <FormSelect id={`${prefix}-source`} name="source" defaultValue={defaults?.source ?? "tavsiye"}>
          {RECRUIT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {RECRUIT_SOURCE_LABEL[s]}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Sorumlu" htmlFor={`${prefix}-owner`}>
        <PersonSelect
          id={`${prefix}-owner`}
          name="owner_id"
          defaultValue={defaults?.owner_id ?? ""}
          people={members}
          emptyLabel={defaults ? "Atanmadı" : "Ben"}
        />
      </FormField>
      <FormField label="Emlak deneyimi (yıl)" htmlFor={`${prefix}-exp`}>
        <FormInput id={`${prefix}-exp`} name="experience_years" type="number" inputMode="numeric" min={0} max={60} defaultValue={defaults?.experience_years ?? ""} placeholder="0 = yeni başlayan" />
      </FormField>
      <FormField label="Şu anki ofis / iş" htmlFor={`${prefix}-office`}>
        <FormInput id={`${prefix}-office`} name="current_office" maxLength={160} defaultValue={defaults?.current_office ?? ""} placeholder="İsteğe bağlı" />
      </FormField>
      <FormField label="Özet not" htmlFor={`${prefix}-message`} className="sm:col-span-2">
        <FormTextarea id={`${prefix}-message`} name="message" rows={3} maxLength={2000} defaultValue={defaults?.message ?? ""} placeholder="Nereden tanışıldı, hangi bölge/portföy türüyle ilgileniyor?" />
      </FormField>
    </div>
  );
}
