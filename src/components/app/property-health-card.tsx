import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Shield,
  XCircle,
} from "lucide-react";
import type { PropertyHealthScore, ListingQualityScore } from "@/lib/property-health";

const GRADE_STYLES: Record<string, { ring: string; badge: string; label: string }> = {
  A: { ring: "stroke-mint-500",  badge: "bg-mint-50 text-mint-700",  label: "Mükemmel" },
  B: { ring: "stroke-brand-500",    badge: "bg-brand-50 text-brand-700",        label: "İyi" },
  C: { ring: "stroke-amber-400",    badge: "bg-amber-50 text-amber-700",      label: "Orta" },
  D: { ring: "stroke-orange-500",   badge: "bg-orange-50 text-orange-700",    label: "Zayıf" },
  F: { ring: "stroke-red-500",      badge: "bg-red-50 text-red-700",          label: "Kritik" },
};

const RING_C = 2 * Math.PI * 28;

// ---------------------------------------------------------------------------
// Portföy sağlık skoru kartı (server component — static)
// ---------------------------------------------------------------------------

export function PropertyHealthCard({ health }: { health: PropertyHealthScore }) {
  const style = GRADE_STYLES[health.grade] ?? GRADE_STYLES.F;
  const dash = RING_C * (1 - health.score / 100);

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Shield className="h-4 w-4 text-brand-600" /> Portföy sağlık skoru
        </h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.badge}`}>
          {health.grade} — {style.label}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-5">
        {/* Halka grafik */}
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="none" stroke="var(--line)" strokeWidth="7" />
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              className={style.ring}
              style={{ strokeDasharray: RING_C, strokeDashoffset: dash }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-base font-extrabold text-ink-950">{health.score}</span>
          </div>
        </div>

        {/* Özet */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold text-ink-950">{health.passed}/{health.total}</span>
            <span className="text-text-muted">kriter karşılandı</span>
          </div>
          {health.criticalMissing.length > 0 && (
            <div className="mt-2 space-y-1">
              {health.criticalMissing.slice(0, 3).map((m) => (
                <p key={m} className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                  <XCircle className="h-3.5 w-3.5 shrink-0" /> {m}
                </p>
              ))}
            </div>
          )}
          {health.criticalMissing.length === 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-mint-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Kritik eksik yok
            </p>
          )}
        </div>
      </div>

      {/* Tüm kriterler (katlanır) */}
      <details className="mt-4 group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline">
          Tüm kriterleri gör
          <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-1.5">
          {health.items.map((item) => (
            <div key={item.key} className={`flex items-start gap-2 rounded-[8px] px-2.5 py-2 text-xs ${item.passed ? "bg-mint-500/8" : item.weight === 3 ? "bg-red-50" : "bg-amber-50/60"}`}>
              {item.passed
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
                : item.weight === 3
                  ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              }
              <div>
                <p className={`font-medium ${item.passed ? "text-ink-950" : "text-text-muted"}`}>{item.label}</p>
                {!item.passed && item.tip && (
                  <p className="mt-0.5 text-[11px] text-text-faint">{item.tip}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// İlan kalite puanı kartı
// ---------------------------------------------------------------------------

export function ListingQualityCard({ quality }: { quality: ListingQualityScore }) {
  const style = GRADE_STYLES[quality.grade] ?? GRADE_STYLES.F;
  const failing = quality.items.filter((i) => !i.passed);

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> İlan kalite puanı
        </h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.badge}`}>
          {quality.score}/100 — {style.label}
        </span>
      </div>

      {failing.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-mint-700">
          <CheckCircle2 className="h-4 w-4" /> İlan içeriği mükemmel!
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-text-muted">Puan artırmak için:</p>
          {failing.map((item) => (
            <div key={item.key} className="flex items-start gap-2 rounded-[8px] bg-canvas/60 px-3 py-2 text-xs">
              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.weight >= 3 ? "text-red-500" : "text-amber-500"}`} />
              <div>
                <p className="font-medium text-ink-950">{item.label}</p>
                {item.tip && <p className="mt-0.5 text-[11px] text-text-faint">{item.tip}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
