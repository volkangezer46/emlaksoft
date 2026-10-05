import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { summarizeSeries, type PremiumTone } from "./premium-math";
import { AreaChart as VizAreaChart } from "../viz/area-chart";
import { RadialGauge } from "../viz/radial-gauge";
import { vizToneColor } from "../viz/colors";

/**
 * Saf SVG/CSS veri görselleştirme (sunucu bileşenleri, istemci JS yok). Hepsi YALNIZ
 * gerçek veriyle çizilir: seri yoksa/yetersizse hiçbir şey çizmez (çağıran boş durum
 * gösterir). Erişilebilirlik: role="img" + özet aria-label.
 */

const GRID_STEPS = [0.25, 0.5, 0.75, 1];

/**
 * BarColumns — gerçek etiketli sütun grafiği (HTML/CSS: kenarlar bozulmaz, etiketler
 * hizalı). Son sütun vurgulu, öncekiler yumuşak. `format` değer etiketi/title içindir.
 * Hepsi sıfırsa null döner. Yükseklik sabit (CLS yok).
 */
export function BarColumns({
  values,
  labels,
  tone = "brand",
  height = 168,
  format,
  ariaLabel,
  className,
}: {
  values: readonly number[];
  labels: readonly string[];
  tone?: PremiumTone;
  height?: number;
  format: (v: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) return null;
  const lastIdx = values.length - 1;
  return (
    <div role="img" aria-label={ariaLabel} className={cn(`pm-t-${tone}`, className)}>
      <div className="relative" style={{ height }}>
        {GRID_STEPS.map((s) => (
          <span
            key={s}
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-dashed border-[var(--hairline-strong)]"
            style={{ bottom: `${s * 100}%` }}
          />
        ))}
        <div className="absolute inset-0 flex items-end gap-2 sm:gap-3">
          {values.map((v, i) => {
            const pct = Math.max(v > 0 ? 3 : 0, (v / max) * 100);
            const isLast = i === lastIdx;
            return (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                {v > 0 ? (
                  <span
                    className={cn(
                      "mb-1 max-w-full truncate text-xs font-semibold tabular-nums",
                      isLast ? "pm-money" : "text-[var(--text-muted)]",
                    )}
                    title={format(v)}
                  >
                    {format(v)}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  className="pm-bar w-full rounded-t-[var(--radius-control)]"
                  style={{
                    height: `${pct}%`,
                    animationDelay: `${i * 40}ms`,
                    background: isLast
                      ? "linear-gradient(180deg, var(--gold-300), var(--gold-500))"
                      : "linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, transparent), color-mix(in srgb, var(--accent) 22%, transparent))",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3" aria-hidden="true">
        {labels.map((l, i) => (
          <span
            key={i}
            className={cn("min-w-0 flex-1 text-center text-xs", i === lastIdx ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]")}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

export type AreaSeries = { name: string; values: readonly number[]; tone?: PremiumTone };

/**
 * AreaChart — viz kitine (`@/components/ui/viz`) yönlenen ince sarmalayıcı (eski dışa
 * aktarım korunur). Çizgi + gradyan alan, ortak ölçek, ilk görünümde bir kez çizilme,
 * sr-only veri tablosu. `labels` altta gösterilen eksen etiketleridir (ilk/orta/son).
 */
export function AreaChart({
  series,
  labels,
  height = 176,
  unit,
  ariaLabel,
  className,
}: {
  series: readonly AreaSeries[];
  labels?: readonly string[];
  height?: number;
  unit?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const usable = series.filter((s) => s.values.length >= 2 && s.values.every((v) => Number.isFinite(v)));
  return (
    <VizAreaChart
      series={series.map((s) => ({ name: s.name, values: s.values, tone: s.tone }))}
      axisLabels={labels}
      showLast={false}
      height={height}
      ariaLabel={ariaLabel ?? usable.map((s) => `${s.name}: ${summarizeSeries(s.values, unit)}`).join(" · ")}
      className={className}
    />
  );
}

/**
 * Ring — halka (donut) ilerleme; viz `RadialGauge`'e yönlenir (eski dışa aktarım korunur).
 * `pct` 0–100 arası GERÇEK oran (üst sınır 100'e kırpılır; taşma metinde ayrıca gösterilir).
 * Altın = para/hedef; ton verilmezse altın.
 */
export function Ring({
  pct,
  size = 96,
  stroke = 9,
  tone = "gold",
  ariaLabel,
  children,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  tone?: PremiumTone;
  ariaLabel: string;
  children?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <RadialGauge
      value={clamped}
      max={100}
      size={size}
      stroke={stroke}
      color={tone === "gold" ? "var(--gold-500)" : vizToneColor(tone, 0)}
      format="percent"
      ariaLabel={ariaLabel}
    >
      {children}
    </RadialGauge>
  );
}

/**
 * EmptyArt — anlamlı boş durum çizimi (saf SVG, dekoratif). Veri uydurmaz: yalnızca
 * "burada henüz kayıt yok" hissini verir; yanında mutlaka açıklayıcı metin ve eylem olur.
 */
export function EmptyArt({ kind = "chart", className }: { kind?: "chart" | "check" | "calendar"; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 72" width="120" height="72" className={cn("block", className)} fill="none">
      <ellipse cx="60" cy="64" rx="46" ry="5" fill="var(--hairline)" />
      {kind === "chart" ? (
        <>
          <rect x="22" y="38" width="14" height="24" rx="4" fill="var(--accent)" opacity="0.18" />
          <rect x="43" y="26" width="14" height="36" rx="4" fill="var(--accent)" opacity="0.3" />
          <rect x="64" y="32" width="14" height="30" rx="4" fill="var(--accent)" opacity="0.22" />
          <rect x="85" y="14" width="14" height="48" rx="4" fill="var(--gold-500)" opacity="0.55" />
          <path d="M18 30 C 36 22, 50 34, 68 20 S 94 8, 104 6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" opacity="0.6" />
        </>
      ) : kind === "check" ? (
        <>
          <circle cx="60" cy="32" r="24" fill="var(--pm-chart-success)" opacity="0.14" />
          <circle cx="60" cy="32" r="17" fill="var(--pm-chart-success)" opacity="0.22" />
          <path d="M51 33 l7 7 l13 -15" stroke="var(--pm-chart-success)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <rect x="30" y="10" width="60" height="48" rx="8" fill="var(--accent)" opacity="0.14" stroke="var(--accent)" strokeOpacity="0.4" />
          <rect x="30" y="10" width="60" height="14" rx="8" fill="var(--accent)" opacity="0.3" />
          <circle cx="46" cy="38" r="3" fill="var(--accent)" opacity="0.5" />
          <circle cx="60" cy="38" r="3" fill="var(--gold-500)" opacity="0.7" />
          <circle cx="74" cy="38" r="3" fill="var(--accent)" opacity="0.5" />
          <circle cx="46" cy="49" r="3" fill="var(--accent)" opacity="0.3" />
          <circle cx="60" cy="49" r="3" fill="var(--accent)" opacity="0.3" />
        </>
      )}
    </svg>
  );
}
