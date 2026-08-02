"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, XCircle } from "lucide-react";
import { setTicketStatusAsTenant } from "@/app/actions/tickets";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function TenantTicketControls({
  ticketId,
  status,
  version,
}: {
  ticketId: string;
  status: string;
  /** İyimser eşzamanlılık kontrolü — bkz. support_tickets.version. */
  version: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ error?: string; success?: string }>({});
  const terminal = status === "resolved" || status === "closed";

  function changeStatus(next: "open" | "closed") {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const formData = new FormData();
          formData.set("id", ticketId);
          formData.set("status", next);
          formData.set("expected_version", String(version));
          const result = await setTicketStatusAsTenant(formData);
          if (!result.ok) {
            setFeedback({ error: result.error ?? "Talep durumu güncellenemedi." });
            resolve();
            return;
          }
          setFeedback({ success: next === "open" ? "Talep yeniden açıldı." : "Talep kapatıldı." });
          router.refresh();
        } catch {
          setFeedback({ error: "İşlem sırasında bağlantı kesildi." });
        }
        resolve();
      });
    });
  }

  return (
    <div className="space-y-2">
      <ConfirmDialog
        trigger={
          <button
            type="button"
            disabled={pending}
            className={`focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${terminal ? "border-brand-300 bg-brand-600/5 text-brand-700 hover:bg-brand-600/10" : "border-line text-text-muted hover:border-danger-500/40 hover:text-danger-600"}`}
          >
            {terminal ? <RotateCcw className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {pending ? "İşleniyor…" : terminal ? "Talebi yeniden aç" : "Talebi kapat"}
          </button>
        }
        title={terminal ? "Talep yeniden açılsın mı?" : "Talep kapatılsın mı?"}
        description={terminal ? "Sorunun devam ettiğini destek ekibine bildirir ve konuşmayı yeniden açar." : "Kapatılan talebe yeni yanıt yazılamaz; gerekirse daha sonra yeniden açabilirsiniz."}
        confirmLabel={terminal ? "Yeniden aç" : "Talebi kapat"}
        tone={terminal ? "default" : "danger"}
        onConfirm={() => changeStatus(terminal ? "open" : "closed")}
      />
      <p className={`min-h-4 text-xs font-medium ${feedback.error ? "text-danger-600" : "text-mint-700"}`} role={feedback.error ? "alert" : "status"} aria-live="polite">
        {feedback.error ?? feedback.success ?? ""}
      </p>
    </div>
  );
}
