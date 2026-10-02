"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { useToast } from "@/components/app/toast-provider";
import { createApprovalRequest, type ApprovalResult } from "@/app/actions/approvals";
import { APPROVAL_KINDS, APPROVAL_KIND_META, type ApprovalKind } from "@/lib/approvals";

const init: ApprovalResult = {};

const fieldCls =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";
const labelCls = "mb-1.5 block text-sm font-medium text-ink-950";

/**
 * Yeni onay talebi (tam sayfa).
 *
 * Alan ETİKETLERİ türe göre değişiyor (komisyon → %, gider → ₺). Sabit
 * "mevcut değer / talep edilen değer" başlıkları kullanıcıyı birimde
 * yanıltıyordu: %3 mü 3 TL mi belli olmuyordu.
 */
export function NewApprovalForm({ entityOptions }: { entityOptions: ComboboxOption[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [kind, setKind] = useState<ApprovalKind>("komisyon_indirimi");
  const [entity, setEntity] = useState("");
  const [state, action, isPending] = useActionState(createApprovalRequest, init);

  useEffect(() => {
    if (state?.ok) {
      push("Onay talebi gönderildi", "ok");
      router.push("/app/onaylar");
    }
  }, [state, push, router]);

  const meta = APPROVAL_KIND_META[kind];
  // Seçici tek değer taşır ("deal:<uuid>"); action iki alan bekliyor.
  const [entityType, entityId] = entity ? entity.split(":") : ["", ""];
  const step = meta.unit === "yuzde" ? "0.1" : "1";

  return (
    <form action={action}>
      <FormPage
        title="Yeni onay talebi"
        description="Müdür onayı gereken işi kayda alın — karar gerekçesiyle birlikte loglanır."
        breadcrumbs={[{ label: "Onaylar", href: "/app/onaylar" }, { label: "Yeni onay talebi" }]}
      >
        <FormSection title="Talep">
          <div>
            <label className={labelCls} htmlFor="ar-kind">
              Talep türü <span className="text-danger-500">*</span>
            </label>
            <select
              id="ar-kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ApprovalKind)}
              className={`${fieldCls} appearance-none`}
            >
              {APPROVAL_KINDS.map((k) => (
                <option key={k} value={k}>{APPROVAL_KIND_META[k].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ar-title">
              Başlık <span className="text-danger-500">*</span>
            </label>
            <input
              id="ar-title"
              name="title"
              required
              maxLength={200}
              className={fieldCls}
              placeholder="ör. Kadıköy dairesinde komisyon indirimi"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ar-current">{meta.currentLabel}</label>
            <input id="ar-current" name="current_value" type="number" step={step} className={fieldCls} placeholder="ör. 3" />
          </div>
          <div>
            <label className={labelCls} htmlFor="ar-requested">{meta.requestedLabel}</label>
            <input id="ar-requested" name="requested_value" type="number" step={step} className={fieldCls} placeholder="ör. 2" />
          </div>
        </FormSection>

        <FormSection title="Kayıt ve gerekçe">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="ar-entity">
              İlgili kayıt <span className="text-xs text-text-faint">(opsiyonel)</span>
            </label>
            {/* Combobox: anlaşma + gider tek havuzda, yazarak aranır. */}
            <Combobox
              id="ar-entity"
              options={entityOptions}
              value={entity}
              onValueChange={setEntity}
              placeholder="— Anlaşma veya gider seçin —"
              searchPlaceholder="Anlaşma / gider ara…"
              emptyText="Eşleşen kayıt yok"
              aria-label="İlgili kayıt"
            />
            <input type="hidden" name="entity_type" value={entityType} />
            <input type="hidden" name="entity_id" value={entityId} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="ar-desc">Gerekçe / açıklama</label>
            <textarea
              id="ar-desc"
              name="description"
              rows={4}
              className={`${fieldCls} resize-none`}
              placeholder="Neden bu istisna gerekiyor? Müşteri/rekabet durumu…"
            />
          </div>
        </FormSection>

        {state?.error ? (
          <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <FormActions>
          <ButtonLink href="/app/onaylar" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={isPending}>
            <ShieldCheck className="h-4 w-4" /> {isPending ? "Gönderiliyor…" : "Onaya gönder"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
