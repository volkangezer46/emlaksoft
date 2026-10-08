"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { createTicketMacro, deleteTicketMacro } from "@/app/actions/admin-ticket-ops";
import { updateTicketMacro } from "@/app/actions/admin-ticket-extra";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";

export type MacroRow = { id: string; title: string; body: string };

function MacroPanel({ macro, canEdit }: { macro?: MacroRow; canEdit: boolean }) {
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
      tabs={[{ id: "makro", label: "Makro", fields: ["title", "body"] }]}
      panels={{
        makro: (
          <>
            <FormField label="Başlık" htmlFor={`macro-title-${k}`} required className="sm:col-span-2">
              <FormInput id={`macro-title-${k}`} name="title" required maxLength={120} defaultValue={macro?.title ?? ""} />
            </FormField>
            <FormField label="Yanıt metni" htmlFor={`macro-body-${k}`} required className="sm:col-span-2">
              <FormTextarea id={`macro-body-${k}`} name="body" required minLength={3} maxLength={5000} rows={6} defaultValue={macro?.body ?? ""} />
            </FormField>
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
      <button
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
        className="focus-ring min-h-9 rounded-[var(--radius-control)] bg-danger-600 px-2.5 py-1 font-bold text-white disabled:opacity-60"
      >
        {pending ? "Siliniyor…" : "Evet, sil"}
      </button>
      <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="focus-ring min-h-9 px-2 font-semibold text-text-muted">Vazgeç</button>
      {error ? <span role="alert" className="w-full font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}

export function MacroList({ macros, canEdit }: { macros: MacroRow[]; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2"><MacroPanel canEdit={canEdit} /></div>
      {macros.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">Henüz hazır yanıt yok.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {macros.map((m) => (
            <li key={m.id} className="space-y-2 px-5 py-3">
              <p className="text-sm font-semibold text-ink-950">{m.title}</p>
              <p className="whitespace-pre-line text-xs text-text-muted">{m.body}</p>
              {canEdit ? (
                <div className="flex flex-wrap items-start gap-2">
                  <MacroPanel macro={m} canEdit />
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
