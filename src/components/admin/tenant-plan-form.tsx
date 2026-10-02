"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTenantPlanStatus } from "@/app/actions/platform";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const selectCls =
  "rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400";
const submitCls =
  "rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-800";

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
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const destructive = status !== currentStatus ? DESTRUCTIVE_STATUS[status] : undefined;

  async function saveSelection() {
    setFeedback(null);
    const formData = new FormData();
    formData.set("id", tenantId);
    formData.set("plan", plan);
    formData.set("status", status);
    try {
      const result = await updateTenantPlanStatus(formData);
      if (!result.ok) {
        setFeedback({ kind: "error", text: result.error ?? "Abonelik güncellenemedi." });
        return;
      }
      setFeedback({ kind: "success", text: "Paket ve abonelik durumu güncellendi." });
      router.refresh();
    } catch {
      setFeedback({ kind: "error", text: "İşlem sırasında bağlantı kesildi. Lütfen tekrar deneyin." });
    }
  }

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
          onConfirm={saveSelection}
        />
      ) : (
        <button
          type="button"
          className={submitCls}
          disabled={pending}
          onClick={() => startTransition(saveSelection)}
        >
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      )}
      {feedback ? (
        <p
          className={`w-full text-xs font-semibold ${feedback.kind === "error" ? "text-danger-500" : "text-mint-600"}`}
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
