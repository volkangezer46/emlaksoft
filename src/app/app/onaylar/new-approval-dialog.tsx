"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { createApprovalRequest, type ApprovalResult } from "@/app/actions/approvals";
import { APPROVAL_KINDS, APPROVAL_KIND_META, type ApprovalKind } from "@/lib/approvals";

const init: ApprovalResult = {};

const fieldCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/**
 * Yeni onay talebi.
 *
 * Alan ETİKETLERİ türe göre değişiyor (komisyon → %, gider → ₺). Sabit
 * "mevcut değer / talep edilen değer" başlıkları kullanıcıyı birimde
 * yanıltıyordu: %3 mü 3 TL mi belli olmuyordu.
 */
export function NewApprovalDialog({ entityOptions }: { entityOptions: ComboboxOption[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ApprovalKind>("komisyon_indirimi");
  const [entity, setEntity] = useState("");
  const [state, action, isPending] = useActionState(createApprovalRequest, init);

  if (state?.ok && open) setOpen(false);

  const meta = APPROVAL_KIND_META[kind];
  // Seçici tek değer taşır ("deal:<uuid>"); action iki alan bekliyor.
  const [entityType, entityId] = entity ? entity.split(":") : ["", ""];
  const step = meta.unit === "yuzde" ? "0.1" : "1";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Yeni onay talebi
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<ShieldCheck />}
          title="Yeni onay talebi"
          description="Müdür onayı gereken işi kayda alın — karar gerekçesiyle birlikte loglanır."
        />
        <form action={action} className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ar-kind">
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
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ar-title">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ar-current">
                {meta.currentLabel}
              </label>
              <input id="ar-current" name="current_value" type="number" step={step} className={fieldCls} placeholder="ör. 3" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ar-requested">
                {meta.requestedLabel}
              </label>
              <input id="ar-requested" name="requested_value" type="number" step={step} className={fieldCls} placeholder="ör. 2" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ar-entity">
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

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ar-desc">
              Gerekçe / açıklama
            </label>
            <textarea
              id="ar-desc"
              name="description"
              rows={3}
              className={`${fieldCls} resize-none`}
              placeholder="Neden bu istisna gerekiyor? Müşteri/rekabet durumu…"
            />
          </div>

          {state?.error ? (
            <p className="rounded-[10px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="hairline-t flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:border-hairline-strong hover:bg-canvas"
              >
                İptal
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={isPending}
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {isPending ? "Gönderiliyor…" : "Onaya gönder"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
