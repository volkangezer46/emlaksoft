"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2Off, Pencil, StickyNote, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { deleteValuation, revokeValuationShare, updateValuation } from "@/app/actions/valuations";

const BTN =
  "focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:border-brand-300";

/** Rapor düzenle (başlık, not), paylaşımı kapat, sil. Düzenleme sayfa içi panel; silme onaylı. */
export function ValuationManage({
  valuationId,
  title,
  notes,
  shared,
  canEdit,
  canDelete,
}: {
  valuationId: string;
  title: string | null;
  notes: string | null;
  shared: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateValuation(valuationId, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {canEdit ? (
        <InlineTabbedPanel
          open={open}
          onOpenChange={setOpen}
          title="Raporu düzenle"
          icon={<Pencil />}
          onSubmit={onSubmit}
          pending={pending}
          error={error}
          fieldLabels={{ title: "Başlık", notes: "Not" }}
          trigger={({ onClick, ...aria }) => (
            <button type="button" onClick={onClick} {...aria} className={BTN}>
              <Pencil className="h-4 w-4" /> Düzenle
            </button>
          )}
          tabs={[{ id: "rapor", label: "Rapor", icon: StickyNote, fields: ["title", "notes"] }]}
          panels={{
            rapor: (
              <>
                <FormField label="Rapor başlığı" htmlFor="val-title" required className="sm:col-span-2">
                  <FormInput name="title" required maxLength={200} defaultValue={title ?? ""} />
                </FormField>
                <FormField label="Not" htmlFor="val-notes" className="sm:col-span-2">
                  <FormTextarea name="notes" rows={5} maxLength={5000} defaultValue={notes ?? ""} />
                </FormField>
              </>
            ),
          }}
        />
      ) : null}
      {canEdit && shared ? (
        <ConfirmDialog
          title="Paylaşım linki kapatılsın mı?"
          description="Müşteriye gönderilmiş link çalışmaz olur. Yeniden paylaşırsanız yeni bir link üretilir."
          confirmLabel="Paylaşımı kapat"
          onConfirm={async () => {
            const res = await revokeValuationShare(valuationId);
            if (res.error) setError(res.error);
            else router.refresh();
          }}
          trigger={
            <button type="button" className={BTN}>
              <Link2Off className="h-4 w-4" /> Paylaşımı kapat
            </button>
          }
        />
      ) : null}
      {canDelete ? (
        <ConfirmDialog
          title="Değerleme raporu silinsin mi?"
          description="Rapor ve paylaşım linki kalıcı olarak silinir."
          confirmLabel="Sil"
          onConfirm={async () => {
            const res = await deleteValuation(valuationId);
            if (res.error) setError(res.error);
            else router.push("/app/degerleme");
          }}
          trigger={
            <button type="button" className={`${BTN} text-danger-500`}>
              <Trash2 className="h-4 w-4" /> Sil
            </button>
          }
        />
      ) : null}
      {error && !open ? (
        <span role="alert" className="text-xs font-semibold text-danger-500">
          {error}
        </span>
      ) : null}
    </>
  );
}
