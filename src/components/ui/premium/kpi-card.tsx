import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniBars } from "./mini-bars";
import { hasSeries, type PremiumTone, type Trend } from "./premium-math";
import { Sparkline } from "./sparkline";
import { TrendPill } from "./trend-pill";

/**
 * KpiCard v3 — ikon rozeti, başlık + sağ ok, büyük değer, trend rozeti, önceki dönem
 * metni ve alt grafik. "Sıfır çıkmaz metrik": `href` ZORUNLU; kart filtrelenmiş
 * hedefe götürür. Alt grafik yalnız GERÇEK seri verilirse çizilir (`series`, en az
 * 2 nokta); yoksa alan hiç ayrılmaz. Sunucu bileşeni, token renkleri, koyu temada uyumlu.
 */
export type KpiCardProps = {
  label: string;
  /** Biçimlenmiş değer ("₺1,2 Mn") ya da sayı. */
  value: ReactNode;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  /** `computeTrend(...)` çıktısı. */
  trend?: Trend;
  /** "Önceki dönem 6" gibi karşılaştırma metni; yoksa `hint`. */
  previousText?: string;
  /** Trend yokken alt açıklama (ör. "1 talepte SLA aşıldı"). */
  hint?: ReactNode;
  /** Değer vurgusu: dikkat gerektiriyorsa değer ton renginde. */
  attention?: boolean;
  /** Gerçek geçmiş seri (en eski → en yeni). */
  series?: readonly number[];
  chart?: "line" | "bars";
  /** Seri birimi ("hafta", "ay") — erişilebilir özet için. */
  seriesUnit?: string;
  /** Erişilebilir grafik özeti (verilmezse seriden üretilir). */
  seriesLabel?: string;
  className?: string;
};

export function KpiCard({
  label,
  value,
  href,
  icon: Icon,
  tone = "brand",
  trend,
  previousText,
  hint,
  attention = false,
  series,
  chart = "line",
  seriesUnit,
  seriesLabel,
  className,
}: KpiCardProps) {
  const drawChart = hasSeries(series);
  return (
    <Link href={href} className={cn(`pm-card pm-t-${tone} focus-ring group`, className)}>
      <span className="pm-card-head">
        <span className="pm-ico" aria-hidden="true">
          <Icon />
        </span>
        <span className="pm-card-title truncate">{label}</span>
        <ChevronRight className="pm-card-arrow h-4 w-4" aria-hidden="true" />
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="pm-value" style={attention ? { color: "var(--t-text)" } : undefined}>
          {value}
        </span>
        {trend ? <TrendPill trend={trend} /> : null}
      </span>
      {previousText || hint ? <span className="pm-sub">{previousText ?? hint}</span> : null}
      {drawChart ? (
        <span className="pm-chart block">
          {chart === "bars" ? (
            <MiniBars data={series} tone={tone} unit={seriesUnit} label={seriesLabel} width={160} height={36} fluid />
          ) : (
            <Sparkline data={series} tone={tone} unit={seriesUnit} label={seriesLabel} height={40} />
          )}
        </span>
      ) : null}
    </Link>
  );
}
