"use client";

import { FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";

/** Sunucudan gelen etkin tanımın istemci alt kümesi (yeni kayıt formları). */
export type CustomFieldInputDef = { id: string; label: string; fieldType: string; options: string[]; required: boolean };

/**
 * Yeni kayıt formunda ofisin özel alanları (`cf_<def_id>`). Doğrulama ve yazım sunucuda (`src/lib/custom-fields/save.ts`).
 * Tanım yoksa hiçbir şey çizmez. Her alanın görünür etiketi vardır.
 */
export function CustomFieldInputs({ defs }: { defs: readonly CustomFieldInputDef[] }) {
  if (defs.length === 0) return null;
  return (
    <fieldset className="sm:col-span-2 space-y-3 rounded-[var(--radius-card)] border border-line p-3">
      <legend className="px-1 text-xs font-semibold text-text-muted">Özel alanlar</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {defs.map((f) => {
          const name = `cf_${f.id}`;
          const id = `yeni-cf-${f.id}`;
          return (
            <div key={f.id} className="space-y-1.5">
              <label htmlFor={id} className="block text-xs font-semibold text-ink-950">
                {f.label}
                {f.required ? <span className="ml-0.5 text-danger-500">*</span> : null}
              </label>
              {f.fieldType === "select" ? (
                <FormSelect id={id} name={name} defaultValue="" required={f.required}>
                  <option value="">Seçin</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </FormSelect>
              ) : f.fieldType === "boolean" ? (
                <FormSelect id={id} name={name} defaultValue="" required={f.required}>
                  <option value="">Belirtilmedi</option>
                  <option value="evet">Evet</option>
                  <option value="hayir">Hayır</option>
                </FormSelect>
              ) : f.fieldType === "date" ? (
                <FormInput id={id} name={name} type="date" required={f.required} />
              ) : f.fieldType === "number" ? (
                <FormInput id={id} name={name} inputMode="decimal" required={f.required} />
              ) : (
                <FormTextarea id={id} name={name} rows={2} maxLength={2000} required={f.required} />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
