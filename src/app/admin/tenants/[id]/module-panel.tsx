"use client";

import { buttonClass } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2 } from "lucide-react";
import { setTenantModuleByAdmin } from "@/app/actions/modules";
import { MODULES } from "@/lib/modules/registry";

export type AdminModuleStatus = "ok" | "unavailable" | "error";

/**
 * Ofis 360 > Yönetim > Modüller: ofis bazında modülü ZORUNLU aç/kapa ya da platform kilidini kaldır.
 * Kilitli satırı ofis kullanıcısı değiştiremez (rozet "Platform"). Her işlem platform denetim kaydına
 * ve ofisin denetim kaydına yazılır. Veri silinmez.
 */
export function ModulePanel({
  tenantId,
  closed,
  locked,
  status,
  canEdit,
}: {
  tenantId: string;
  closed: string[];
  locked: string[];
  status: AdminModuleStatus;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);

  function run(moduleKey: string, mode: "force_on" | "force_off" | "release") {
    setFeedback(null);
    setBusyKey(moduleKey);
    startTransition(async () => {
      try {
        const res = await setTenantModuleByAdmin(tenantId, moduleKey, mode);
        setFeedback(res.error ? { error: res.error } : { message: res.message ?? "Kaydedildi." });
        if (!res.error) router.refresh();
      } catch {
        setFeedback({ error: "İşlem sırasında bağlantı kesildi. Lütfen tekrar deneyin." });
      } finally {
        setBusyKey(null);
      }
    });
  }

  const btn = buttonClass({ variant: "outline", size: "sm" });

  return (
    <section
      id="yonetim-moduller"
      aria-labelledby="yonetim-moduller-title"
      className="dashboard-panel mt-4 scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface"
    >
      <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">
          <Layers className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="yonetim-moduller-title" className="font-display text-base font-bold text-ink-950">Modüller</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Ofis için modülü zorunlu aç/kapa. Kilitli modülü ofis kendi ekranından değiştiremez. Veri silinmez.
          </p>
        </div>
      </div>
      <div className="space-y-3 p-5">
        {status === "unavailable" ? (
          <p role="status" className="rounded-[var(--radius-control)] bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
            Modül yönetimi henüz etkin değil (veritabanı güncellemesi uygulanmamış). Tüm modüller açık.
          </p>
        ) : null}
        {status === "error" ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-600">
            Modül durumu okunamadı.
          </p>
        ) : null}
        {feedback ? (
          feedback.error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-600">{feedback.error}</p>
          ) : (
            <p role="status" className="rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-700">{feedback.message}</p>
          )
        ) : null}
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {MODULES.map((m) => {
            const isClosed = closed.includes(m.key);
            const isLocked = locked.includes(m.key);
            const busy = pending && busyKey === m.key;
            const editable = canEdit && status === "ok";
            return (
              <li key={m.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-950">{m.label}</p>
                  <p className="text-xs text-text-faint">
                    {isClosed ? "Kapalı" : "Açık"}
                    {isLocked ? " · Platform kilidi" : ""}
                  </p>
                </div>
                {editable ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" aria-hidden /> : null}
                    <button type="button" className={btn} disabled={pending} onClick={() => run(m.key, "force_on")}>
                      Zorunlu aç
                    </button>
                    <button type="button" className={btn} disabled={pending} onClick={() => run(m.key, "force_off")}>
                      Zorunlu kapat
                    </button>
                    {isLocked ? (
                      <button type="button" className={btn} disabled={pending} onClick={() => run(m.key, "release")}>
                        Kilidi kaldır
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
