"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createContractTemplate,
  deleteContractTemplate,
  setContractTemplateActive,
  updateContractTemplate,
} from "@/app/actions/contract-templates";
import { useToast } from "@/components/app/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

export type ContractTemplateRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  isActive: boolean;
  isGlobal: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  satis: "Satış",
  kira: "Kira",
  sozlesme: "Yetki / hizmet",
  teklif: "Teklif",
  yer_gosterme: "Yer gösterme",
  kapora: "Kapora",
  diger: "Diğer",
};

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";

function TemplatePanel({
  template,
  open,
  onOpenChange,
  trigger,
}: {
  template: ContractTemplateRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger?: Parameters<typeof InlineTabbedPanel>[0]["trigger"];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = template ? await updateContractTemplate({}, fd) : await createContractTemplate({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push(template ? "Şablon güncellendi" : "Şablon eklendi", "ok");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Şablonu düzenle" : "Yeni sözleşme şablonu"}
      description={template?.title}
      icon={<FileText />}
      onSubmit={submit}
      pending={pending}
      error={error}
      hiddenFields={template ? <input type="hidden" name="id" value={template.id} /> : undefined}
      fieldLabels={{ title: "Şablon adı", type: "Tür", content: "İçerik" }}
      trigger={trigger}
      tabs={[
        { id: "bilgi", label: "Bilgi", icon: FileText, fields: ["title", "type"] },
        { id: "icerik", label: "İçerik", icon: Pencil, fields: ["content"] },
      ]}
      panels={{
        bilgi: (
          <>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Şablon adı
              <input name="title" required maxLength={160} defaultValue={template?.title ?? ""} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Tür
              <select name="type" defaultValue={template?.type ?? "diger"} className={`mt-1 ${fieldClass}`}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </>
        ),
        icerik: (
          <label className="text-xs font-semibold text-text-muted sm:col-span-2">
            İçerik
            <textarea name="content" required rows={14} defaultValue={template?.content ?? ""} className={`mt-1 font-mono ${fieldClass}`} />
          </label>
        ),
      }}
    />
  );
}

function Row({ t, canEdit }: { t: ContractTemplateRow; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await setContractTemplateActive(t.id, !t.isActive);
      if (res.error) push(res.error, "err");
      else {
        push(t.isActive ? "Şablon pasife alındı" : "Şablon aktif edildi", "ok");
        router.refresh();
      }
    });
  }

  async function remove() {
    const res = await deleteContractTemplate(t.id);
    if (res.error) push(res.error, "err");
    else {
      push("Şablon silindi", "ok");
      router.refresh();
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink-950">{t.title}</p>
        <p className="mt-0.5 text-xs text-text-muted">
          {TYPE_LABELS[t.type] ?? t.type} · {t.isGlobal ? "Hazır şablon (salt okunur)" : "Ofis şablonu"} ·{" "}
          {t.isActive ? "Aktif" : "Pasif"}
        </p>
      </div>
      {canEdit && !t.isGlobal ? (
        <div className="flex items-center gap-1.5">
          <TemplatePanel
            template={t}
            open={editOpen}
            onOpenChange={setEditOpen}
            trigger={({ onClick, ...aria }) => (
              <button type="button" onClick={onClick} {...aria} className="focus-ring press inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-text-muted hover:border-brand-300">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Düzenle
              </button>
            )}
          />
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="focus-ring press inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-text-muted hover:border-brand-300 disabled:opacity-50"
          >
            {t.isActive ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {t.isActive ? "Pasife al" : "Aktif et"}
          </button>
          <ConfirmDialog
            title="Şablonu sil"
            description={`"${t.title}" şablonu silinecek. Bu şablondan oluşturulmuş sözleşmeler etkilenmez.`}
            confirmLabel="Sil"
            onConfirm={remove}
            trigger={
              <button type="button" aria-label="Şablonu sil" className="focus-ring press grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-danger-500 hover:border-danger-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            }
          />
        </div>
      ) : null}
    </li>
  );
}

export function ContractTemplatesManager({ templates, canEdit }: { templates: ContractTemplateRow[]; canEdit: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <section className="space-y-4">
      {canEdit ? (
        <TemplatePanel
          template={null}
          open={createOpen}
          onOpenChange={setCreateOpen}
          trigger={({ onClick, ...aria }) => (
            <button type="button" onClick={onClick} {...aria} className="focus-ring btn-shine inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
              <Plus className="h-4 w-4" aria-hidden="true" /> Yeni şablon
            </button>
          )}
        />
      ) : (
        <p className="text-xs text-text-muted">Şablonları düzenlemek için ayar düzenleme yetkisi gerekir; bu ekran salt okunurdur.</p>
      )}
      {templates.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
          Henüz şablon yok. &quot;Yeni şablon&quot; ile ilk şablonunuzu ekleyin.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {templates.map((t) => (
            <Row key={t.id} t={t} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}
