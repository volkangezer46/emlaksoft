import type { LucideIcon } from "lucide-react";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import type { PremiumTone, Trend } from "@/components/ui/premium/premium-math";
import { KpiCardSkeleton } from "@/components/ui/kpi-card";

/**
 * StatCard — dashboard KPI kartı (eski imza korunur; v4 `layout="inline"`). Görünüm artık TEK uygulama olan
 * `KpiTile`'dan gelir (KpiCard / KpiStrip ile aynı kart); bu bileşen yalnız eski prop'ları eşler.
 *
 * Tıklanabilirlik standardı ("sıfır çıkmaz metrik"): `href` verilen kart Link olur.
 * `trend` hem eski `"up" | "down" | "neutral"` + `trendLabel` imzasını hem de
 * `{ value, direction, label, good }` nesnesini kabul eder. `sparkline` yalnız gerçek seri ile verilir.
 */

type TrendDirection = "up" | "down" | "neutral";

export type StatTrend = {
  /** Yüzde değeri (işaretsiz de verilebilir; gösterimde `%` eklenir). */
  value: number;
  /** Okun yönü — veri yönü. */
  direction: TrendDirection;
  /** Rozetin yanına yazılacak açıklama, ör. "geçen aya göre". */
  label?: string;
  /** Yön iyi mi? Varsayılan: `up` iyi. Kayıp/gider gibi metriklerde `false`. */
  good?: boolean;
};

type Tone = "neutral" | "brand" | "success" | "mint" | "warning" | "warn" | "amber" | "danger";

const TONE_MAP: Record<Tone, PremiumTone> = {
  neutral: "brand",
  brand: "brand",
  success: "success",
  mint: "success",
  warning: "warn",
  warn: "warn",
  amber: "warn",
  danger: "danger",
};

function toTrend(t: StatTrend): Trend {
  const dir = t.direction === "up" ? "up" : t.direction === "down" ? "down" : "flat";
  const good = dir === "flat" ? null : (t.good ?? dir === "up");
  const pct = Math.abs(t.value);
  const sign = dir === "up" ? "+" : dir === "down" ? "-" : "";
  return {
    dir,
    label: `%${sign}${pct}`,
    pct: dir === "flat" ? null : pct,
    good,
    sr: dir === "flat" ? "Önceki döneme göre değişmedi" : `Önceki döneme göre yüzde ${pct} ${dir === "up" ? "arttı" : "azaldı"}`,
  };
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendLabel,
  tone = "neutral",
  href,
  sparkline,
  loading = false,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Eski imza (`"up"`) veya v2 nesnesi — ikisi de desteklenir. */
  trend?: TrendDirection | StatTrend;
  /** Eski imza ile birlikte kullanılan serbest metin rozeti. */
  trendLabel?: string;
  tone?: Tone;
  /** Kartın drill-down hedefi (örn. /app/komisyon?durum=bekleyen) */
  href?: string;
  /** Son dönemlerin mini grafiği — en az 2 nokta anlamlı olur. */
  sparkline?: number[];
  /** Veri beklenirken gerçek kartla aynı ölçüde iskelet. */
  loading?: boolean;
  /** Eski prop; hareket artık kart bileşeninde tek yerde (kullanılmaz). */
  animate?: boolean;
}) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" className="h-full">
        <span className="sr-only">{label} yükleniyor</span>
        <KpiCardSkeleton layout="inline" />
      </div>
    );
  }
  const obj = typeof trend === "object" && trend !== null ? toTrend(trend) : undefined;
  const previousText =
    typeof trend === "object" && trend !== null ? trend.label : typeof trend === "string" ? trendLabel : undefined;
  return (
    <KpiTile
      label={label}
      value={value}
      icon={Icon}
      href={href}
      tone={TONE_MAP[tone]}
      trend={obj}
      previousText={previousText}
      series={sparkline}
      seriesUnit="dönem"
      layout="inline"
    />
  );
}

/**
 * Info card for displaying key-value pairs
 */
export function InfoCard({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div className={`rounded-[var(--radius-card)] border border-line bg-surface p-4 ${className ?? ""}`}>
      <dl className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between text-sm">
            <dt className="text-text-muted">{item.label}</dt>
            <dd className="font-semibold text-ink-950">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
