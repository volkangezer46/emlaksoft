import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatDateTimeTr } from "@/lib/format";
import type { PortalDealProcess } from "@/lib/customer-portal/portal-model";

const DATE_ONLY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };

/**
 * Müşteri portalı — tapu süreci ilerleme çubuğu (SALT-OKUNUR). Alıcı da satıcı da aynı adımları görür;
 * yalnız adım adı, durum ve tarih gelir (not ve sorumlu kişi portala hiç gönderilmez).
 */
export function DealProcessProgress({ process }: { process: PortalDealProcess }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-bold text-ink-950">{process.label}</p>
        <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-text-muted">{process.role === "alici" ? "Alıcı olarak" : "Satıcı olarak"}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Progress className="flex-1" value={process.percent} label="Tapu süreci ilerlemesi" tone={process.complete ? "success" : "accent"} />
        <span className="numeric shrink-0 text-xs font-bold text-ink-950">
          {process.doneCount}/{process.total} · %{process.percent}
        </span>
      </div>
      <ol className="mt-4 space-y-2.5">
        {process.steps.map((s) => {
          const Icon = s.status === "done" ? CheckCircle2 : s.status === "current" ? CircleDot : Circle;
          const tone = s.status === "done" ? "text-mint-600" : s.status === "current" ? "text-brand-600" : "text-text-faint";
          return (
            <li key={s.key} className="flex items-start gap-2.5" aria-current={s.status === "current" ? "step" : undefined}>
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${s.status === "upcoming" ? "text-text-muted" : "font-semibold text-ink-950"}`}>{s.label}</p>
                <p className="text-xs text-text-faint">
                  {s.status === "done"
                    ? s.doneAt
                      ? `Tamamlandı · ${formatDateTimeTr(s.doneAt, DATE_ONLY)}`
                      : "Tamamlandı"
                    : s.plannedAt
                      ? `${s.status === "current" ? "Sırada" : "Planlanan"} · ${formatDateTimeTr(s.plannedAt)}`
                      : s.status === "current"
                        ? "Sırada"
                        : "Bekliyor"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
