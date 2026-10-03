"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { createProject } from "@/app/actions/projects";
import { DAY_MS, msUntil } from "@/lib/clock";
import { detailOrList } from "@/lib/form-logic";
import { PROJECT_DRAFT_FIELDS, PROJECT_FORM_ID, PROJECT_TABS } from "./project-tabs";

const TAB_ICONS = { proje: TI.proje, konum: TI.konum, aciklama: TI.aciklama } as const;
const FIELD_LABELS = { name: "Proje adı" };
const STATUS_LABELS: Record<string, string> = {
  planning: "Planlama",
  selling: "Satışta",
  delivered: "Teslim edildi",
};

function deliveryText(value: string): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  const days = Math.ceil(msUntil(value) / DAY_MS);
  const date = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "UTC" }).format(t);
  if (days > 0) return `${date} · ${days} gün kaldı`;
  if (days === 0) return `${date} · bugün`;
  return `${date} · ${-days} gün geçti`;
}

export function NewProjectForm({ userId }: { userId: string }) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createProject({}, fd), {
    successMessage: "Proje oluşturuldu",
    redirectTo: (r) => detailOrList("/app/projeler", r.id),
  });

  const tabs: FormTab[] = useMemo(
    () =>
      PROJECT_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  const tabPanels = {
    proje: (
      <>
        <FormField label="Proje adı" htmlFor="pr-name" required className="sm:col-span-2">
          <FormInput name="name" required placeholder="Örn. Vadi Konakları" />
        </FormField>
        <FormField label="Müteahhit / geliştirici" htmlFor="pr-dev">
          <FormInput name="developer_name" placeholder="Örn. Aksoy İnşaat" />
        </FormField>
        <FormField label="Satış durumu" htmlFor="pr-status">
          <FormSelect name="status" defaultValue="selling">
            <option value="planning">Planlama</option>
            <option value="selling">Satışta</option>
            <option value="delivered">Teslim edildi</option>
          </FormSelect>
        </FormField>
      </>
    ),
    konum: (
      <>
        <FormField label="Konum" htmlFor="pr-loc">
          <FormInput name="location" placeholder="Örn. Çankaya, Ankara" />
        </FormField>
        <FormField label="Teslim tarihi" htmlFor="pr-delivery">
          <FormInput name="delivery_date" type="date" />
        </FormField>
      </>
    ),
    aciklama: (
      <FormField label="Açıklama" htmlFor="pr-desc" className="sm:col-span-2">
        <FormTextarea name="description" rows={6} placeholder="Proje hakkında kısa not…" />
      </FormField>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const name = (values.name ?? "").trim();
    const dev = (values.developer_name ?? "").trim();
    const loc = (values.location ?? "").trim();
    const delivery = deliveryText((values.delivery_date ?? "").trim());
    const desc = (values.description ?? "").trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{name || "Proje adı girilmedi"}</p>
          <p className="truncate text-xs text-text-muted">{dev || "Geliştirici girilmedi"}</p>
        </div>
        <SummaryGroup title="Proje bilgisi">
          <SummaryRow label="Proje adı" value={name || "Zorunlu"} muted={!name} tab="proje" field="name" />
          <SummaryRow label="Durum" value={STATUS_LABELS[values.status ?? ""] ?? "Satışta"} tab="proje" field="status" />
          <SummaryRow label="Konum" value={loc || "Girilmedi"} muted={!loc} tab="konum" field="location" />
          <SummaryRow label="Teslim" value={delivery ?? "Girilmedi"} muted={!delivery} tab="konum" field="delivery_date" />
          <SummaryRow label="Açıklama" value={desc ? `${desc.length} karakter` : "Yok"} muted={!desc} tab="aciklama" field="description" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni proje"
      description="Projeyi oluşturduktan sonra detay ekranından blok ve daireleri ekleyebilirsiniz."
      breadcrumbs={[{ label: "Projeler", href: "/app/projeler" }, { label: "Yeni proje" }]}
      cancelHref="/app/projeler"
      submitLabel="Proje oluştur"
      pendingLabel="Oluşturuluyor…"
      submitIcon={Plus}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: PROJECT_FORM_ID, fields: [...PROJECT_DRAFT_FIELDS] }}
    />
  );
}
