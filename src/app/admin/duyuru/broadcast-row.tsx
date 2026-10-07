"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { deleteBroadcast, updateBroadcast } from "@/app/actions/platform-notifications";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { KIND_OPTIONS } from "./broadcast-options";

export type BroadcastRowData = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  audienceLabel: string;
  tenantId: string | null;
  tenantName: string | null;
  sentCount: number;
  createdLabel: string;
};

/** Duyuru geçmişi satırı: gövdeyi aç/kapat, düzenle (satır içi panel), geri çek (satır içi onay). */
export function BroadcastRow({ row, canEdit, isSuperAdmin }: { row: BroadcastRowData; canEdit: boolean; isSuperAdmin: boolean }) {
  const router = useRouter();
  const kindOpt = KIND_OPTIONS.find((k) => k.value === row.kind);
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  function save(fd: FormData) {
    setError(null);
    fd.set("id", row.id);
    start(async () => {
      const r = await updateBroadcast(fd);
      if (r.error) {
        setError(r.error);
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="px-5 py-3 transition hover:bg-brand-600/[0.02]">
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto_auto] sm:items-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="focus-ring flex min-w-0 items-center gap-2 text-left"
        >
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${kindOpt?.cls ?? "bg-canvas text-text-muted"}`}>{kindOpt?.label ?? row.kind}</span>
          <span className="truncate text-sm font-semibold text-ink-950">{row.title}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-faint transition ${expanded ? "rotate-180" : ""}`} />
        </button>
        <p className="text-xs text-text-muted">
          {row.tenantId ? (
            <Link href={`/admin/tenants/${row.tenantId}`} className="font-semibold text-brand-600 transition hover:underline">
              {row.tenantName ?? "Belirli ofis"}
            </Link>
          ) : (
            row.audienceLabel
          )}
        </p>
        <span className="numeric w-fit rounded-full bg-mint-500/10 px-2.5 py-1 text-xs font-bold text-mint-600">{row.sentCount} ofis</span>
        <p className="text-xs text-text-faint">{row.createdLabel}</p>
      </div>

      {expanded ? (
        <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 text-sm">
          {row.body ? <p className="whitespace-pre-line text-text-muted">{row.body}</p> : <p className="text-text-faint">Mesaj gövdesi yok.</p>}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <InlineTabbedPanel
            open={editOpen}
            onOpenChange={(v) => {
              if (v) setError(null);
              setEditOpen(v);
            }}
            title="Duyuruyu düzenle"
            description="Değişiklik arşive ve ofislerin bildirim kutusundaki mesaja yansır."
            icon={<Pencil />}
            onSubmit={save}
            pending={pending}
            error={error}
            summary={false}
            trigger={({ onClick, ...aria }) => (
              <button type="button" onClick={onClick} {...aria} className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-950 hover:border-brand-300">
                <Pencil className="h-3.5 w-3.5 text-brand-600" /> Düzenle
              </button>
            )}
            tabs={[{ id: "icerik", label: "İçerik", fields: ["title", "body", "kind"] }]}
            panels={{
              icerik: (
                <>
                  <FormField label="Başlık" htmlFor={`bc-title-${row.id}`} required className="sm:col-span-2">
                    <FormInput id={`bc-title-${row.id}`} name="title" required maxLength={120} defaultValue={row.title} />
                  </FormField>
                  <FormField label="Mesaj" htmlFor={`bc-body-${row.id}`} className="sm:col-span-2">
                    <FormTextarea id={`bc-body-${row.id}`} name="body" rows={4} maxLength={2000} defaultValue={row.body ?? ""} />
                  </FormField>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-2 text-sm font-medium text-ink-950">Tür</legend>
                    <div className="flex flex-wrap gap-2">
                      {KIND_OPTIONS.map((k) => (
                        <label key={k.value} className="cursor-pointer">
                          <input type="radio" name="kind" value={k.value} defaultChecked={k.value === row.kind} className="peer sr-only" />
                          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ring-2 ring-transparent transition peer-checked:ring-current peer-focus-visible:ring-brand-500 ${k.cls}`}>{k.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              ),
            }}
          />
          {isSuperAdmin ? (
            confirmDelete ? (
              <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 px-2.5 py-1.5 text-xs">
                <span className="font-semibold text-danger-600">Duyuru ofislerin bildirim kutusundan da silinsin mi?</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const fd = new FormData();
                      fd.set("id", row.id);
                      const r = await deleteBroadcast(fd);
                      if (r.error) {
                        setDelError(r.error);
                        return;
                      }
                      router.refresh();
                    })
                  }
                  className="focus-ring min-h-9 rounded-[var(--radius-control)] bg-danger-600 px-2.5 py-1 font-bold text-white disabled:opacity-60"
                >
                  {pending ? "Siliniyor…" : "Evet, geri çek"}
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} className="focus-ring min-h-9 px-2 font-semibold text-text-muted">Vazgeç</button>
                {delError ? <span role="alert" className="w-full font-semibold text-danger-600">{delError}</span> : null}
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-danger-500/30 px-2.5 py-1.5 text-xs font-semibold text-danger-600 hover:bg-danger-500/10">
                <Trash2 className="h-3.5 w-3.5" /> Geri çek
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
