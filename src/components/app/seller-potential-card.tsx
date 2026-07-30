import { TrendingUp, Check } from "lucide-react";
import type { SellerPrediction } from "@/lib/seller-prediction";

const TIER = {
  high: { cls: "border-mint-500/30 bg-mint-500/10 text-mint-700", bar: "bg-mint-500" },
  medium: { cls: "border-amber-400/30 bg-amber-400/10 text-amber-700", bar: "bg-amber-400" },
  low: { cls: "border-line bg-canvas text-text-muted", bar: "bg-slate-400" },
} as const;

/**
 * "Satış potansiyeli" — malik-tipi müşteride, yakında portföy listeleme
 * olasılığını gösterir (bkz. seller-prediction.ts). Saf sunum bileşeni.
 */
export function SellerPotentialCard({ prediction }: { prediction: SellerPrediction }) {
  const t = TIER[prediction.tier];
  return (
    <div className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <TrendingUp className="h-4 w-4" /> Satış potansiyeli
        </p>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${t.cls}`}>
          {prediction.label}
        </span>
      </div>

      <div className="mt-3 flex items-end gap-3">
        <p className="font-display text-3xl font-extrabold leading-none text-ink-950">{prediction.score}</p>
        <div className="mb-1 flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
            <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${prediction.score}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-text-faint">/100 listeleme olasılığı</p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {prediction.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-text-muted">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" /> {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
