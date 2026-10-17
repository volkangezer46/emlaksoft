"use client";

import { FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";

/** Sunucudan gelen etkin tanımın istemci alt kümesi (yeni kayıt formları). */
export type CustomFieldInputDef = { id: string; label: string; fieldType: string; options: string[]; required: boolean };

/**
 * Yeni kayıt formunda ofisin özel alanları (`cf_<def_id>`). Doğrulama ve yazım sunucuda (`src/lib/custom-fields/save.ts`).
 * Tanım yoksa hiçbir şey çizmez. Her alanın görünür etiketi vardır.
 */
export function CustomFieldInputs({
  defs,
  values,
  onFieldChange,
}: {
  defs: readonly CustomFieldInputDef[];
  /** Sihirbaz (adım değişince alan yeniden bağlanır): girilen değerler geri yazılır. */
  values?: Readonly<Record<string, string>>;
  /** Sihirbaz: her değişimde `cf_<id>` adı ve değeri. Verilmezse alanlar kontrolsüzdür (FormData ile gider). */
  onFieldChange?: (name: string, value: string) => void;
}) {
  if (defs.length === 0) return null;
  return (
    <fieldset
      className="sm:col-span-2 space-y-3 rounded-[var(--radius-card)] border border-line p-3"
      onChange={
        onFieldChange
          ? (e) => {
              const t = e.target as unknown as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
              if (t.name?.startsWith("cf_")) onFieldChange(t.name, t.value);
            }
          : undefined
      }
    >
      <legend className="px-1 text-xs font-semibold text-text-muted">Özel alanlar</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {defs.map((f) => {
          const name = `cf_${f.id}`;
          const id = `yeni-cf-${f.id}`;
          const initial = values?.[name] ?? "";
          return (
            <div key={f.id} className="space-y-1.5">
              <label htmlFor={id} className="block text-xs font-semibold text-ink-950">
                {f.label}
                {f.required ? <span className="ml-0.5 text-danger-500">*</span> : null}
              </label>
              {f.fieldType === "select" ? (
                <FormSelect id={id} name={name} defaultValue={initial} required={f.required}>
                  <option value="">Seçin</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </FormSelect>
              ) : f.fieldType === "boolean" ? (
                <FormSelect id={id} name={name} defaultValue={initial} required={f.required}>
                  <option value="">Belirtilmedi</option>
                  <option value="evet">Evet</option>
                  <option value="hayir">Hayır</option>
                </FormSelect>
              ) : f.fieldType === "date" ? (
                <FormInput id={id} name={name} type="date" defaultValue={initial} required={f.required} />
              ) : f.fieldType === "number" ? (
                <FormInput id={id} name={name} inputMode="decimal" defaultValue={initial} required={f.required} />
              ) : (
                <FormTextarea id={id} name={name} rows={2} maxLength={2000} defaultValue={initial} required={f.required} />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
