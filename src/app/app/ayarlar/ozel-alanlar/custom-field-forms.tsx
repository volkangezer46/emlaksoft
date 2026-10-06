"use client";

import { useActionState, useState, useTransition } from "react";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  setCustomFieldActive,
  updateCustomFieldDef,
  type CustomFieldResult,
} from "@/app/actions/custom-fields";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_ENTITY_LABELS, CUSTOM_FIELD_TYPES, CUSTOM_FIELD_TYPE_LABELS } from "@/lib/custom-fields/core";

export function CreateCustomFieldForm() {
  const [state, action, pending] = useActionState<CustomFieldResult, FormData>(createCustomFieldDef, {});
  const [type, setType] = useState("text");
  return (
    <form action={action} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="font-display font-bold text-ink-950">Yeni alan</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1.4fr_1fr]">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">Kayıt türü</span>
          <FormSelect name="entity" defaultValue="customer">
            {CUSTOM_FIELD_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {CUSTOM_FIELD_ENTITY_LABELS[e]}
              </option>
            ))}
          </FormSelect>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">Alan adı</span>
          <FormInput name="label" maxLength={80} required placeholder="Ör. Kredi onayı" />
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">Tür</span>
          <FormSelect name="field_type" value={type} onChange={(e) => setType(e.target.value)}>
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOM_FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </FormSelect>
        </label>
      </div>
      {type === "select" ? (
        <label className="mt-3 block space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">Seçenekler (her satıra bir tane)</span>
          <FormTextarea name="options" rows={3} placeholder={"Doğalgaz\nKlima\nYerden ısıtma"} />
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-ink-950">
          <input type="checkbox" name="required" className="h-4 w-4" /> Zorunlu alan
        </label>
        <Button type="submit" icon={Plus} loading={pending}>
          Alan ekle
        </Button>
      </div>
      {state.error ? <p role="alert" className="mt-2 text-sm text-danger-600">{state.error}</p> : null}
      {state.ok ? <p className="mt-2 text-sm text-mint-700">Alan eklendi.</p> : null}
    </form>
  );
}

type RowDef = { id: string; label: string; typeLabel: string; fieldType: string; options: string[]; required: boolean; active: boolean };

export function CustomFieldRow({ def, canEdit }: { def: RowDef; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [state, action, pending] = useActionState<CustomFieldResult, FormData>(updateCustomFieldDef, {});
  const [busy, start] = useTransition();
  const { push } = useToast();

  function toggleActive() {
    const fd = new FormData();
    fd.set("id", def.id);
    fd.set("active", def.active ? "0" : "1");
    start(async () => {
      const res = await setCustomFieldActive(fd);
      if (res.error) push(res.error, "err");
      else push(def.active ? "Alan gizlendi" : "Alan gösteriliyor");
    });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${def.active ? "text-ink-950" : "text-text-faint line-through"}`}>
            {def.label}
            {def.required ? <span className="ml-1 text-danger-500">*</span> : null}
          </p>
          <p className="text-xs text-text-muted">
            {def.typeLabel}
            {def.options.length > 0 ? ` · ${def.options.join(", ")}` : ""}
            {!def.active ? " · gizli" : ""}
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              Düzenle
            </Button>
            <Button variant="ghost" size="sm" icon={def.active ? EyeOff : Eye} loading={busy} onClick={toggleActive}>
              {def.active ? "Gizle" : "Göster"}
            </Button>
            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleting((v) => !v)} aria-expanded={deleting}>
              Sil
            </Button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <form action={action} className="mt-3 grid gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={def.id} />
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold text-ink-950">Alan adı</span>
            <FormInput name="label" defaultValue={def.label} maxLength={80} required />
          </label>
          <label className="inline-flex items-center gap-2 self-end text-sm text-ink-950">
            <input type="checkbox" name="required" defaultChecked={def.required} className="h-4 w-4" /> Zorunlu
          </label>
          {def.fieldType === "select" ? (
            <label className="space-y-1.5 sm:col-span-2">
              <span className="block text-xs font-semibold text-ink-950">Seçenekler (her satıra bir tane)</span>
              <FormTextarea name="options" rows={3} defaultValue={def.options.join("\n")} />
            </label>
          ) : null}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" size="sm" loading={pending}>
              Kaydet
            </Button>
            {state.error ? <p role="alert" className="text-xs text-danger-600">{state.error}</p> : null}
            {state.ok ? <p className="text-xs text-mint-700">Kaydedildi.</p> : null}
          </div>
        </form>
      ) : null}
      {deleting ? <DeleteFieldForm id={def.id} /> : null}
    </li>
  );
}

function DeleteFieldForm({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState("");
  const { push } = useToast();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/[0.05] p-3">
      <p className="text-xs text-text-muted">Alan ve tüm kayıtlardaki değerleri kalıcı silinir. Onay için &quot;sil&quot; yazın:</p>
      <FormInput value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-24" aria-label="Silme onayı" />
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        disabled={confirm !== "sil"}
        onClick={() => {
          const fd = new FormData();
          fd.set("id", id);
          fd.set("confirm", confirm);
          start(async () => {
            const res = await deleteCustomFieldDef(fd);
            if (res.error) push(res.error, "err");
            else push("Alan silindi");
          });
        }}
      >
        Kalıcı sil
      </Button>
    </div>
  );
}
