"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import { useCreateForm } from "@/components/app/use-create-form";
import { createApprovalRequest } from "@/app/actions/approvals";
import { APPROVAL_KINDS, APPROVAL_KIND_META, type ApprovalKind } from "@/lib/approvals";

/**
 * Yeni onay talebi (tam sayfa).
 *
 * Alan ETİKETLERİ türe göre değişiyor (komisyon → %, gider → ₺). Sabit
 * "mevcut değer / talep edilen değer" başlıkları kullanıcıyı birimde
 * yanıltıyordu: %3 mü 3 TL mi belli olmuyordu.
 */
export function NewApprovalForm({ entityOptions }: { entityOptions: ComboboxOption[] }) {
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

  return (
    <FormShell
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
    >
      <FormSection title="Talep">
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
      </FormSection>

      <FormSection title="Kayıt ve gerekçe">
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
          <FormTextarea name="description" rows={4} placeholder="Neden bu istisna gerekiyor? Müşteri/rekabet durumu…" />
        </FormField>
      </FormSection>
    </FormShell>
  );
}
