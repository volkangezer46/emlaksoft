"use client";

import { useState } from "react";
import { setTenantPlanStatus } from "@/app/actions/platform";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const selectCls =
  "rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400";
const submitCls =
  "rounded-[9px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-800";

/** Erişimi kesen durum geçişleri — onaysız kaydedilemez. */
const DESTRUCTIVE_STATUS: Record<string, { title: string; description: string; confirmLabel: string }> = {
  suspended: {
    title: "Ofis askıya alınsın mı?",
    description: "Askıya alma, ofisin panele erişimini anında keser. Geri almak için durumu tekrar aktif yapmanız gerekir.",
    confirmLabel: "Askıya al",
  },
  cancelled: {
    title: "Ofis iptal edilsin mi?",
    description: "İptal edilen ofis panele erişemez ve aboneliği kapatılır; veri kaydı silinmez.",
    confirmLabel: "İptal et",
  },
};

/**
 * Plan/durum değiştirme formu. "Askıya al" ve "İptal" gibi yıkıcı geçişlerde
 * kaydetmeden önce ConfirmDialog ister; diğer geçişler doğrudan kaydedilir.
 */
export function TenantPlanForm({
  tenantId,
  tenantName,
  currentPlan,
  currentStatus,
  planOptions,
  statusOptions,
}: {
  tenantId: string;
  tenantName: string;
  currentPlan: string;
  currentStatus: string;
  planOptions: [string, string][];
  statusOptions: [string, string][];
}) {
  const [plan, setPlan] = useState(currentPlan);
  const [status, setStatus] = useState(currentStatus);

  const destructive = status !== currentStatus ? DESTRUCTIVE_STATUS[status] : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        aria-label={`${tenantName} paketi`}
        className={selectCls}
      >
        {planOptions.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        aria-label={`${tenantName} durumu`}
        className={selectCls}
      >
        {statusOptions.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {destructive ? (
        <ConfirmDialog
          trigger={
            <button type="button" className={submitCls}>
              Kaydet
            </button>
          }
          title={destructive.title}
          description={`${tenantName} — ${destructive.description}`}
          confirmLabel={destructive.confirmLabel}
          formAction={setTenantPlanStatus}
          hiddenFields={{ id: tenantId, plan, status }}
        />
      ) : (
        <form action={setTenantPlanStatus}>
          <input type="hidden" name="id" value={tenantId} />
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="status" value={status} />
          <button type="submit" className={submitCls}>
            Kaydet
          </button>
        </form>
      )}
    </div>
  );
}
