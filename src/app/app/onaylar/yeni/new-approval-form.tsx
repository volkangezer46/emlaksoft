"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { useCreateForm } from "@/components/app/use-create-form";
import { createApprovalRequest } from "@/app/actions/approvals";
import { APPROVAL_KINDS, APPROVAL_KIND_META, type ApprovalKind } from "@/lib/approvals";
import { APPROVAL_DRAFT_FIELDS, APPROVAL_FORM_ID, APPROVAL_TABS } from "./approval-tabs";

const TAB_ICONS = { talep: TI.onay, kayit: TI.kayit } as const;
const FIELD_LABELS = { kind: "Talep türü", title: "Başlık" };

/**
 * Yeni onay talebi (tam sayfa, sekmeli kabuk).
 *
 * Alan ETİKETLERİ türe göre değişiyor (komisyon → %, gider → ₺). Sabit
 * "mevcut değer / talep edilen değer" başlıkları kullanıcıyı birimde
 * yanıltıyordu: %3 mü 3 TL mi belli olmuyordu.
 */
export function NewApprovalForm({ entityOptions, userId }: { entityOptions: ComboboxOption[]; userId: string }) {
  const [kind, setKind] = useState<ApprovalKind>("komisyon_indirimi");
  const [entity, setEntity] = useState("");
  const { onSubmit, pending, error } = useCreateForm((fd) => createApprovalRequest({}, fd), {
    successMessage: "Onay talebi gönderildi",
    redirectTo: () => "/app/onaylar",
  });

  const meta = APPROVAL_KIND_META[kind];
  // Seçici tek değer taşır ("deal:<uuid>"); action iki alan bekliyor.
  const [entityType, entityId] = entity ? entity.split(":") : ["", ""];
  const step = meta.unit === "yuzde" ? "0.1" : "1";
  const unitSuffix = meta.unit === "yuzde" ? "%" : "₺";

  const tabs: FormTab[] = useMemo(
    () =>
      APPROVAL_TABS.map((t) => ({
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
    talep: (
      <>
        <FormField label="Talep türü" htmlFor="ar-kind" required>
          <FormSelect name="kind" value={kind} onChange={(e) => setKind(e.target.value as ApprovalKind)}>
            {APPROVAL_KINDS.map((k) => (
              <option key={k} value={k}>{APPROVAL_KIND_META[k].label}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Başlık" htmlFor="ar-title" required>
          <FormInput name="title" required maxLength={200} placeholder="ör. Kadıköy dairesinde komisyon indirimi" />
        </FormField>
        <FormField label={meta.currentLabel} htmlFor="ar-current">
          <FormInput name="current_value" type="number" step={step} placeholder="ör. 3" />
        </FormField>
        <FormField label={meta.requestedLabel} htmlFor="ar-requested">
          <FormInput name="requested_value" type="number" step={step} placeholder="ör. 2" />
        </FormField>
      </>
    ),
    kayit: (
      <>
        <FormField label="İlgili kayıt (opsiyonel)" htmlFor="ar-entity" className="sm:col-span-2">
          {/* Combobox: anlaşma + gider tek havuzda, yazarak aranır. */}
          <Combobox
            options={entityOptions}
            value={entity}
            onValueChange={setEntity}
            placeholder="— Anlaşma veya gider seçin —"
            searchPlaceholder="Anlaşma / gider ara…"
            emptyText="Eşleşen kayıt yok"
            aria-label="İlgili kayıt"
          />
        </FormField>
        <input type="hidden" name="entity_type" value={entityType} />
        <input type="hidden" name="entity_id" value={entityId} />
        <FormField label="Gerekçe / açıklama" htmlFor="ar-desc" className="sm:col-span-2">
          <FormTextarea name="description" rows={6} placeholder="Neden bu istisna gerekiyor? Müşteri/rekabet durumu…" />
        </FormField>
      </>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const current = (values.current_value ?? "").trim();
    const requested = (values.requested_value ?? "").trim();
    const entityLabel = entityOptions.find((o) => o.value === entity)?.label;
    const desc = (values.description ?? "").trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="text-xs font-semibold text-text-muted">{meta.label}</p>
          <p className="truncate text-sm font-semibold text-ink-950">{title || "Başlık girilmedi"}</p>
        </div>
        <SummaryGroup title="Talep özeti">
          <SummaryRow label="Başlık" value={title || "Zorunlu"} muted={!title} tab="talep" field="title" />
          <SummaryRow
            label="Değişiklik"
            value={current || requested ? `${current || "—"} → ${requested || "—"} ${unitSuffix}` : "Girilmedi"}
            muted={!current && !requested}
            tab="talep"
            field="current_value"
          />
          <SummaryRow label="İlgili kayıt" value={entityLabel ?? "Seçilmedi"} muted={!entityLabel} tab="kayit" />
          <SummaryRow label="Gerekçe" value={desc ? `${desc.length} karakter` : "Yok"} muted={!desc} tab="kayit" field="description" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni onay talebi"
      description="Müdür onayı gereken işi kayda alın — karar gerekçesiyle birlikte loglanır."
      breadcrumbs={[{ label: "Onaylar", href: "/app/onaylar" }, { label: "Yeni onay talebi" }]}
      cancelHref="/app/onaylar"
      submitLabel="Onaya gönder"
      pendingLabel="Gönderiliyor…"
      submitIcon={ShieldCheck}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: APPROVAL_FORM_ID, fields: [...APPROVAL_DRAFT_FIELDS] }}
    />
  );
}
