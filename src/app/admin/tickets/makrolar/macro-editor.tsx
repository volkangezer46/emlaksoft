"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { createTicketMacro, deleteTicketMacro } from "@/app/actions/admin-ticket-ops";
import { updateTicketMacro } from "@/app/actions/admin-ticket-extra";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { Combobox } from "@/components/ui/combobox";
import { MACRO_VARIABLES, type MacroActions } from "@/lib/support/macro-template";

export type MacroRow = {
  id: string;
  title: string;
  body: string;
  actions: MacroActions;
  /** Eylem özetinin okunur satırları (sunucuda hazırlanır). */
  actionSummary: string[];
  useCount: number;
};
export type StaffOption = { value: string; label: string };

const selectClass =
  "focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm text-ink-950 outline-none focus:border-brand-400";

function MacroPanel({
  macro,
  canEdit,
  extended,
  staff,
}: {
  macro?: MacroRow;
  canEdit: boolean;
  extended: boolean;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const k = macro?.id ?? "new";
  if (!canEdit) return null;

  function submit(fd: FormData) {
    setError(null);
    if (macro) fd.set("id", macro.id);
    start(async () => {
      const r = macro ? await updateTicketMacro(fd) : await createTicketMacro(fd);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={(v) => {
        if (v) setError(null);
        setOpen(v);
      }}
      title={macro ? "Hazır yanıtı düzenle" : "Yeni hazır yanıt"}
      description={macro?.title}
      icon={<Pencil />}
      onSubmit={submit}
      pending={pending}
      error={error}
      summary={false}
      trigger={({ onClick, ...aria }) => (
        <Button variant="outline" size="sm" type="button" onClick={onClick} {...aria}>
          <Pencil className="h-3.5 w-3.5 text-brand-600" /> {macro ? "Düzenle" : "Yeni hazır yanıt"}
        </Button>
      )}
      tabs={[
        { id: "makro", label: "Makro", fields: ["title", "body"] },
        ...(extended ? [{ id: "eylem", label: "Eylemler", fields: ["action_status", "action_priority", "action_assign", "action_tags"] }] : []),
      ]}
      panels={{
        makro: (
          <>
            <FormField label="Başlık" htmlFor={`macro-title-${k}`} required className="sm:col-span-2">
              <FormInput id={`macro-title-${k}`} name="title" required maxLength={120} defaultValue={macro?.title ?? ""} />
            </FormField>
            <FormField label="Yanıt metni" htmlFor={`macro-body-${k}`} required className="sm:col-span-2">
              <FormTextarea id={`macro-body-${k}`} name="body" required minLength={3} maxLength={5000} rows={6} defaultValue={macro?.body ?? ""} />
            </FormField>
            <p className="text-xs text-text-muted sm:col-span-2">
              Değişkenler:{" "}
              {MACRO_VARIABLES.map((v, i) => (
                <span key={v.key}>
                  {i ? " · " : ""}
                  <code className="rounded bg-canvas px-1 font-mono">{`{{${v.key}}}`}</code> {v.label.toLocaleLowerCase("tr-TR")}
                </span>
              ))}
            </p>
          </>
        ),
        eylem: (
          <>
            <FormField label="Durum" htmlFor={`macro-status-${k}`}>
              <select id={`macro-status-${k}`} name="action_status" defaultValue={macro?.actions.status ?? ""} className={selectClass}>
                <option value="">Değiştirme</option>
                <option value="open">Açık</option>
                <option value="in_progress">İşleniyor</option>
                <option value="waiting">Yanıt bekliyor</option>
              </select>
            </FormField>
            <FormField label="Öncelik" htmlFor={`macro-priority-${k}`}>
              <select id={`macro-priority-${k}`} name="action_priority" defaultValue={macro?.actions.priority ?? ""} className={selectClass}>
                <option value="">Değiştirme</option>
                <option value="low">Düşük</option>
                <option value="normal">Normal</option>
                <option value="high">Yüksek</option>
                <option value="urgent">Acil</option>
              </select>
            </FormField>
            <FormField label="Atama" htmlFor={`macro-assign-${k}`}>
              <Combobox
                id={`macro-assign-${k}`}
                name="action_assign"
                aria-label="Atama eylemi"
                defaultValue={macro?.actions.assign ?? ""}
                placeholder="Değiştirme"
                searchPlaceholder="Personel ara…"
                options={[
                  { value: "me", label: "Uygulayan kişiye ata" },
                  { value: "none", label: "Atamayı kaldır" },
                  ...staff,
                ]}
              />
            </FormField>
            <FormField label="Etiket ekle (virgülle)" htmlFor={`macro-tags-${k}`}>
              <FormInput id={`macro-tags-${k}`} name="action_tags" maxLength={300} placeholder="fatura, iade" defaultValue={macro?.actions.addTags?.join(", ") ?? ""} />
            </FormField>
            <p className="text-xs text-text-muted sm:col-span-2">Eylemler, makroyla hazırlanan yanıt gönderildiğinde talebe uygulanır. Çözüm ve kapatma çözüm özeti istediği için makroyla yapılmaz.</p>
          </>
        ),
      }}
    />
  );
}

function DeleteMacro({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!confirm) {
    return (
      <Button variant="outline" size="sm" type="button" onClick={() => setConfirm(true)} className="text-danger-600">
        Sil
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 px-2.5 py-1.5 text-xs">
      <span className="font-semibold text-danger-600">“{title}” silinsin mi?</span>
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("id", id);
            const r = await deleteTicketMacro(fd);
            if (r.error) {
              setError(r.error);
              return;
            }
            router.refresh();
          })
        }
        variant="danger" size="sm"
      >
        {pending ? "Siliniyor…" : "Evet, sil"}
      </Button>
      <Button type="button" disabled={pending} onClick={() => setConfirm(false)} variant="ghost" size="sm">Vazgeç</Button>
      {error ? <span role="alert" className="w-full font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}

export function MacroList({
  macros,
  canEdit,
  extended,
  staff,
}: {
  macros: MacroRow[];
  canEdit: boolean;
  extended: boolean;
  staff: StaffOption[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2"><MacroPanel canEdit={canEdit} extended={extended} staff={staff} /></div>
      {macros.length === 0 ? (
        <EmptyState icon={Pencil} title="Henüz hazır yanıt yok" description="Sık verilen cevapları makro olarak kaydedin; destek taleplerinde tek tıkla kullanın." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {macros.map((m) => (
            <li key={m.id} className="space-y-2 px-5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink-950">{m.title}</p>
                {extended ? <span className="text-xs tabular-nums text-text-faint">{m.useCount.toLocaleString("tr-TR")} kullanım</span> : null}
              </div>
              <p className="whitespace-pre-line text-xs text-text-muted">{m.body}</p>
              {m.actionSummary.length ? (
                <p className="flex flex-wrap gap-1.5">
                  {m.actionSummary.map((a) => (
                    <span key={a} className="rounded-full border border-line bg-canvas px-2 py-0.5 text-xs text-text-muted">{a}</span>
                  ))}
                </p>
              ) : null}
              {canEdit ? (
                <div className="flex flex-wrap items-start gap-2">
                  <MacroPanel macro={m} canEdit extended={extended} staff={staff} />
                  <DeleteMacro id={m.id} title={m.title} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
