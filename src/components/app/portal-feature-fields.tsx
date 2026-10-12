"use client";

import { ChevronDown } from "lucide-react";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  CURRENCY_OPTIONS,
  FURNISHED_OPTIONS,
  PARKING_OPTIONS,
  USAGE_STATUS_OPTIONS,
  PORTAL_FEATURES,
  featureFormValue,
} from "@/lib/portal-transfer/features";

/**
 * Portal formlarının istediği ek portföy alanları (yeni portföy formu ve düzenleme penceresi ORTAK kullanır).
 * Değerler `properties.features` jsonb'ye yazılır (`src/lib/portal-transfer/features.ts`, migration yok). Alan adları
 * LİTERAL yazılır: form-tabs sözleşme testi `name="..."` kümesini sekme tanımıyla karşılaştırır.
 */

type Defaults = Record<string, unknown> | null | undefined;

const defOf = (key: string) => {
  const d = PORTAL_FEATURES.find((f) => f.key === key);
  if (!d) throw new Error(`Portal alanı tanımsız: ${key}`);
  return d;
};

function NumberField({ name, idPrefix, defaults, placeholder }: { name: string; idPrefix: string; defaults: Defaults; placeholder?: string }) {
  const def = defOf(name);
  const id = `${idPrefix}-${name}`;
  return (
    <FormField label={def.label} htmlFor={id} hint={def.hint}>
      <FormInput id={id} name={name} inputMode={def.kind === "int" ? "numeric" : "decimal"} defaultValue={featureFormValue(def, defaults ?? undefined)} placeholder={placeholder} />
    </FormField>
  );
}

function TextField({ name, idPrefix, defaults, placeholder }: { name: string; idPrefix: string; defaults: Defaults; placeholder?: string }) {
  const def = defOf(name);
  const id = `${idPrefix}-${name}`;
  return (
    <FormField label={def.label} htmlFor={id}>
      <FormInput id={id} name={name} maxLength={def.max} defaultValue={featureFormValue(def, defaults ?? undefined)} placeholder={placeholder} />
    </FormField>
  );
}

function ChoiceField({ name, idPrefix, defaults, options, yesNo }: { name: string; idPrefix: string; defaults: Defaults; options?: readonly string[]; yesNo?: boolean }) {
  const def = defOf(name);
  const id = `${idPrefix}-${name}`;
  const current = featureFormValue(def, defaults ?? undefined);
  return (
    <FormField label={def.label} htmlFor={id} inject={false}>
      <div className="relative">
        <FormSelect id={id} name={name} defaultValue={current} className="appearance-none">
          <option value="">Seçilmedi</option>
          {yesNo ? (
            <>
              <option value="yes">Evet</option>
              <option value="no">Hayır</option>
            </>
          ) : (
            (options ?? []).map((o) => <option key={o}>{o}</option>)
          )}
        </FormSelect>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
      </div>
    </FormField>
  );
}

export function PortalFeatureFields({ defaults, idPrefix = "pf" }: { defaults?: Defaults; idPrefix?: string }) {
  return (
    <>
      <p className="sm:col-span-2 text-xs text-text-muted">
        Portal formlarının istediği ek bilgiler. Boş bırakabilirsiniz; &ldquo;Portala aktar&rdquo; eksikleri size gösterir.
      </p>
      <NumberField name="gross_sqm" idPrefix={idPrefix} defaults={defaults} placeholder="Örn. 120" />
      <NumberField name="net_sqm" idPrefix={idPrefix} defaults={defaults} placeholder="Örn. 105" />
      <NumberField name="total_floors" idPrefix={idPrefix} defaults={defaults} placeholder="Örn. 8" />
      <NumberField name="bathrooms" idPrefix={idPrefix} defaults={defaults} placeholder="Örn. 2" />
      <ChoiceField name="balcony" idPrefix={idPrefix} defaults={defaults} yesNo />
      <ChoiceField name="elevator" idPrefix={idPrefix} defaults={defaults} yesNo />
      <ChoiceField name="parking" idPrefix={idPrefix} defaults={defaults} options={PARKING_OPTIONS} />
      <ChoiceField name="furnished" idPrefix={idPrefix} defaults={defaults} options={FURNISHED_OPTIONS} />
      <ChoiceField name="usage_status" idPrefix={idPrefix} defaults={defaults} options={USAGE_STATUS_OPTIONS} />
      <ChoiceField name="in_site" idPrefix={idPrefix} defaults={defaults} yesNo />
      <TextField name="site_name" idPrefix={idPrefix} defaults={defaults} placeholder="Örn. Bahçeşehir Konakları" />
      <NumberField name="dues" idPrefix={idPrefix} defaults={defaults} placeholder="Örn. 1500" />
      <ChoiceField name="credit_eligible" idPrefix={idPrefix} defaults={defaults} yesNo />
      <ChoiceField name="swap_ok" idPrefix={idPrefix} defaults={defaults} yesNo />
      <ChoiceField name="currency" idPrefix={idPrefix} defaults={defaults} options={CURRENCY_OPTIONS} />
    </>
  );
}
