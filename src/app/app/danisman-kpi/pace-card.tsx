import Link from "next/link";
import { RadialGauge } from "@/components/ui/viz";
import { Progress } from "@/components/ui/progress";
import { paceGauge, paceVerdict } from "./month-progress";

const VERDICT: Record<"ahead" | "on-track" | "behind", { text: string; color: string }> = {
  ahead: { text: "Geçen ayın önünde", color: "var(--viz-pos)" },
  "on-track": { text: "Geçen ayla aynı tempoda", color: "var(--pm-warn-text)" },
  behind: { text: "Geçen ayın gerisinde", color: "var(--viz-neg)" },
};

/**
 * PaceCard — "bu ay vs geçen ay" ekip skoru göstergesi. Halka bu ayın skorunu geçen ayın skoruna
 * oranlar; geçen ayın değeri halkada çentik olarak görünür. Ay ilerlemesi yalnız içinde bulunulan
 * ayda gösterilir (tamamlanmış ayda tempo yorumu anlamsız). Geçen ay 0 ise bileşen çizilmez.
 */
export function PaceCard({
  scoreNow,
  scorePrev,
  elapsedPct,
  prevHref,
  monthLabel,
  prevLabel,
}: {
  scoreNow: number;
  scorePrev: number;
  /** İçinde bulunulan ayda ay ilerlemesi (0-100); geçmiş ayda null. */
  elapsedPct: number | null;
  prevHref: string;
  monthLabel: string;
  prevLabel: string;
}) {
  const g = paceGauge(scoreNow, scorePrev);
  if (!g) return null;
  const verdict = paceVerdict(scoreNow, scorePrev, elapsedPct);
  const v = verdict ? VERDICT[verdict] : null;
  return (
    <section aria-label="Bu ay ve geçen ay" className="surface-card rounded-[var(--radius-panel)] p-5">
      <h2 className="font-display text-base font-bold tracking-[-0.015em] text-text">Bu ay · geçen ay</h2>
      <p className="mt-0.5 text-xs text-text-faint">Ekip skoru toplamı, {prevLabel} ile karşılaştırma</p>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <RadialGauge value={g.value} max={g.max} target={g.target} size={112} stroke={10} tone="accent" ariaLabel={`${monthLabel} ekip skoru ${g.value}, ${prevLabel} ${g.target}`}>
          <span className="font-display text-xl font-extrabold tabular-nums text-text">%{g.ratioPct}</span>
          <span className="block text-xs text-text-faint">geçen ayın</span>
        </RadialGauge>
        <dl className="min-w-48 flex-1 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-muted">{monthLabel}</dt>
            <dd className="font-display font-extrabold tabular-nums text-text">{g.value}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-muted">
              <Link href={prevHref} className="focus-ring rounded hover:text-accent-text hover:underline">
                {prevLabel}
              </Link>
            </dt>
            <dd className="font-display font-extrabold tabular-nums text-text-muted">{g.target}</dd>
          </div>
          {elapsedPct !== null ? (
            <div>
              <div className="flex items-baseline justify-between text-xs text-text-muted">
                <span>Ay ilerlemesi</span>
                <span className="tabular-nums">%{elapsedPct}</span>
              </div>
              <Progress value={elapsedPct} label="Ay ilerlemesi" tone="warning" className="mt-1" />
            </div>
          ) : null}
          {v ? (
            <p className="text-xs font-semibold" style={{ color: v.color }}>
              {v.text}
            </p>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
