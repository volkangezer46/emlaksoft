"use client";

import { useActionState, useState } from "react";
import { Pencil, Save } from "lucide-react";
import { saveCustomFieldValues, type CustomFieldResult } from "@/app/actions/custom-fields";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";

type Field = { id: string; label: string; fieldType: string; options: string[]; required: boolean; display: string; input: string };

export function CustomFieldsForm({ entity, recordId, fields, canEdit }: { entity: string; recordId: string; fields: Field[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<CustomFieldResult, FormData>(async (prev, fd) => {
    const res = await saveCustomFieldValues(prev, fd);
    if (res.ok) setEditing(false);
    return res;
  }, {});

  if (!editing) {
    return (
      <div className="mt-3">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.id} className="min-w-0">
              <dt className="text-xs font-semibold text-text-muted">{f.label}</dt>
              <dd className="whitespace-pre-line break-words text-sm text-ink-950">{f.display || <span className="text-text-faint">—</span>}</dd>
            </div>
          ))}
        </dl>
        {canEdit ? (
          <Button variant="secondary" size="sm" icon={Pencil} className="mt-3" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
        ) : null}
        {state.ok ? <p className="mt-2 text-xs text-mint-700">Kaydedildi.</p> : null}
      </div>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="record_id" value={recordId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const name = `cf_${f.id}`;
          const id = `cf-${f.id}`;
          return (
            <div key={f.id} className="space-y-1.5">
              <label htmlFor={id} className="block text-xs font-semibold text-ink-950">
                {f.label}
                {f.required ? <span className="ml-0.5 text-danger-500">*</span> : null}
              </label>
              {f.fieldType === "select" ? (
                <FormSelect id={id} name={name} defaultValue={f.input} required={f.required}>
                  <option value="">Seçin</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {f.input && !f.options.includes(f.input) ? <option value={f.input}>{f.input} (eski seçenek)</option> : null}
                </FormSelect>
              ) : f.fieldType === "boolean" ? (
                <FormSelect id={id} name={name} defaultValue={f.input} required={f.required}>
                  <option value="">Belirtilmedi</option>
                  <option value="evet">Evet</option>
                  <option value="hayir">Hayır</option>
                </FormSelect>
              ) : f.fieldType === "date" ? (
                <FormInput id={id} name={name} type="date" defaultValue={f.input} required={f.required} />
              ) : f.fieldType === "number" ? (
                <FormInput id={id} name={name} inputMode="decimal" defaultValue={f.input} required={f.required} />
              ) : (
                <FormTextarea id={id} name={name} rows={2} maxLength={2000} defaultValue={f.input} required={f.required} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" icon={Save} loading={pending}>
          Kaydet
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Vazgeç
        </Button>
        {state.error ? <p role="alert" className="text-xs text-danger-600">{state.error}</p> : null}
      </div>
    </form>
  );
}
