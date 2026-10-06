"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save } from "lucide-react";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { FormSelect } from "@/components/ui/form-controls";
import { updateProject, type ProjectResult } from "@/app/actions/projects";
import { PROJECT_STATUS_LABELS } from "@/lib/status-labels";

const PANEL_ID = "proje-duzenle";
const init: ProjectResult = {};

export type EditableProject = {
  id: string;
  name: string;
  developer_name: string | null;
  location: string | null;
  delivery_date: string | null;
  description: string | null;
  status: string;
};

export function ProjectEditTrigger() {
  return (
    <InlinePanelTrigger panelId={PANEL_ID} variant="secondary">
      <Pencil className="h-4 w-4" /> Projeyi düzenle
    </InlinePanelTrigger>
  );
}

/** Proje bilgisi düzenleme: sayfa içi panel (popup değil); kaydedince kapanır ve sayfa yenilenir. */
export function ProjectEditPanel({ project }: { project: EditableProject }) {
  return (
    <InlinePanel id={PANEL_ID} title="Projeyi düzenle" description="Ad, konum, teslim tarihi ve satış durumu." icon={<Pencil />}>
      {(close) => <ProjectEditForm project={project} onDone={close} />}
    </InlinePanel>
  );
}

function ProjectEditForm({ project, onDone }: { project: EditableProject; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateProject, init);
  // Başarıda paneli kapat + sunucu verisini tazele (panel kapanınca form söküldüğü için durum sıfırlanır).
  useEffect(() => {
    if (!state.ok) return;
    onDone();
    router.refresh();
  }, [state, onDone, router]);

  return (
    <form action={action} className="space-y-4 px-4 py-4 md:px-6">
      <input type="hidden" name="id" value={project.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Proje adı" htmlFor="p-name" required>
          <Input id="p-name" name="name" required maxLength={160} defaultValue={project.name} />
        </FormField>
        <FormField label="Müteahhit / geliştirici" htmlFor="p-dev">
          <Input id="p-dev" name="developer_name" maxLength={160} defaultValue={project.developer_name ?? ""} />
        </FormField>
        <FormField label="Konum" htmlFor="p-loc">
          <Input id="p-loc" name="location" maxLength={240} defaultValue={project.location ?? ""} />
        </FormField>
        <FormField label="Teslim tarihi" htmlFor="p-date">
          <Input id="p-date" name="delivery_date" type="date" defaultValue={project.delivery_date?.slice(0, 10) ?? ""} />
        </FormField>
        <FormField label="Durum" htmlFor="p-status">
          <FormSelect id="p-status" name="status" defaultValue={project.status}>
            {Object.keys(PROJECT_STATUS_LABELS).map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>
      <FormField label="Açıklama" htmlFor="p-desc">
        <Textarea id="p-desc" name="description" rows={3} maxLength={2000} defaultValue={project.description ?? ""} />
      </FormField>

      {state.error ? (
        <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="hairline-t flex justify-end gap-2 pt-4">
        <Button type="button" variant="secondary" onClick={onDone}>
          Vazgeç
        </Button>
        <Button type="submit" loading={pending}>
          <Save className="h-4 w-4" /> Kaydet
        </Button>
      </div>
    </form>
  );
}
