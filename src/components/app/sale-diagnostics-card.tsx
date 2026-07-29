import { Activity, AlertTriangle, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import type { SaleDiagnosis } from "@/lib/sale-diagnostics";

const VERDICT = {
  healthy: { label: "Sağlıklı", cls: "border-mint-500/30 bg-mint-500/10 text-mint-700" },
  needs_attention: { label: "İyileştirme gerekli", cls: "border-amber-400/30 bg-amber-400/10 text-amber-700" },
  at_risk: { label: "Risk altında", cls: "border-danger-500/30 bg-danger-500/10 text-danger-600" },
} as const;

/**
 * "Neden satmıyor?" satış teşhis kartı — portföy detayında yalnızca aktif
 * pazarlamadaki ilanlar için gösterilir (bkz. sale-diagnostics.ts). Saf sunum:
 * "use client" yok, sunucuda sıfır JS ile render olur.
 */
export function SaleDiagnosticsCard({ diagnosis }: { diagnosis: SaleDiagnosis }) {
  const v = VERDICT[diagnosis.verdict];
  return (
    <section id="satis-teshis" className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Activity className="h-4 w-4" /> Satış teşhisi
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Neden satmıyor?</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${v.cls}`}>
            {v.label}
          </span>
          <div className="text-right">
            <p className="font-display text-2xl font-extrabold leading-none text-ink-950">{diagnosis.score}</p>
            <p className="text-[10px] text-text-faint">/100 hazırlık</p>
          </div>
        </div>
      </div>

      {diagnosis.blockers.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-mint-500/25 bg-mint-500/[0.07] px-3 py-3 text-sm font-medium text-mint-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> İlanda satışı engelleyen belirgin bir sorun yok — aktif takipte kalın.
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {diagnosis.blockers.map((b) => {
            const crit = b.severity === "critical";
            return (
              <li
                key={b.key}
                className={`rounded-[12px] border px-3 py-2.5 ${crit ? "border-danger-500/25 bg-danger-500/[0.06]" : "border-amber-400/30 bg-amber-400/[0.07]"}`}
              >
                <p className={`flex items-center gap-1.5 text-sm font-semibold ${crit ? "text-danger-600" : "text-amber-700"}`}>
                  {crit ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  {b.title}
                </p>
                <p className="mt-1 text-xs text-text-muted">{b.detail}</p>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-ink-950">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" /> {b.action}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {diagnosis.positives.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {diagnosis.positives.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border border-mint-500/20 bg-mint-500/[0.07] px-2.5 py-1 text-[11px] font-medium text-mint-700"
            >
              <CheckCircle2 className="h-3 w-3" /> {p}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
