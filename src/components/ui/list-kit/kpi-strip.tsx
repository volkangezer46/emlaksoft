import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatCount } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";
import { barHeights, hasSeries, trendOf } from "./list-logic";
import type { PillTone } from "./status-pill";

/**
 * KpiStrip — ikon kapsüllü, tıklanabilir KPI kartları (sıfır çıkmaz metrik: `href` zorunlu).
 *
 * GERÇEK VERİ KURALI: `series` (eskiden yeniye sayılar, ör. haftalık yeni kayıt) yalnız
 * gerçek kayıtlardan hesaplandığında verilir. Verilirse mini renkli çubuklar ve (isteğe bağlı
 * `showTrend`) trend oku çizilir; verilmezse / hepsi sıfırsa kart sade kalır — sahte çubuk yok.
 * `attention`: sıfır değilse değer kırmızıya döner (örn. fiyat uyarısı).
 */
export type KpiItem = {
  label: string;
  value: number | string;
  href: string;
  icon: ReactNode;
  tone?: PillTone;
  /** Değerin altındaki kısa gerçek bilgi ("bu ay", "15 portföy"). */
  hint?: string;
  series?: readonly number[];
  /** Seriden trend oku hesapla (son yarı / önceki yarı). */
  showTrend?: boolean;
  /** Seri/trend etiketi için pencere açıklaması ("son 4 hafta"). */
  seriesLabel?: string;
  attention?: boolean;
};

const TONE_CLASS: Record<PillTone, string> = {
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
  neutral: "tone-neutral",
};

const BAR_COLOR: Record<PillTone, string> = {
  success: "text-[var(--success-strong)]",
  warning: "text-[var(--warning-strong)]",
  danger: "text-[var(--danger-strong)]",
  info: "text-[var(--info-strong)]",
  neutral: "text-[var(--neutral-strong)]",
};

export function KpiStrip({ items, label = "Özet göstergeler", className }: { items: readonly KpiItem[]; label?: string; className?: string }) {
  return (
    <nav
      aria-label={label}
      className={cn("grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]", className)}
    >
      {items.map((it) => {
        const tone = it.tone ?? "info";
        const zero = it.value === 0 || it.value === "0";
        const shown = typeof it.value === "number" ? formatCount(it.value) : it.value;
        const series = hasSeries(it.series) ? it.series : null;
        const trend = series && it.showTrend ? trendOf(series) : null;
        const heights = series ? barHeights(series) : null;
        const TrendIcon = trend?.dir === "up" ? ArrowUpRight : trend?.dir === "down" ? ArrowDownRight : ArrowRight;
        return (
          <Link
            key={`${it.label}-${it.href}`}
            href={it.href}
            className={cn(
              "focus-ring press group flex min-h-[5.5rem] items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--elev-1)] transition hover:border-brand-300 hover:shadow-[var(--shadow-card)]",
              zero && !it.attention && "opacity-70 hover:opacity-100",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] [&>svg]:h-5 [&>svg]:w-5", TONE_CLASS[tone])}
            >
              {it.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-text-muted">{it.label}</span>
              <span
                className={cn(
                  "numeric block truncate font-display text-2xl font-bold leading-tight",
                  it.attention && !zero ? "text-danger-600" : "text-text",
                )}
              >
                {shown}
              </span>
              {trend ? (
                <span
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-xs font-semibold",
                    trend.dir === "up" ? "text-[var(--success-strong)]" : trend.dir === "down" ? "text-[var(--danger-strong)]" : "text-text-muted",
                  )}
                >
                  <TrendIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  {trend.label}
                  <span className="truncate font-normal text-text-muted">{it.seriesLabel ?? "önceki döneme göre"}</span>
                </span>
              ) : it.hint ? (
                <span className="block truncate text-xs text-text-muted">{it.hint}</span>
              ) : null}
            </span>
            {heights && series ? (
              <span
                role="img"
                aria-label={`${it.seriesLabel ?? "Seri"}: ${series.join(", ")}`}
                className={cn("hidden h-9 shrink-0 items-end gap-0.5 sm:flex", BAR_COLOR[tone])}
              >
                {heights.map((h, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-current"
                    style={{ height: `${Math.max(h, 8)}%`, opacity: h === 0 ? 0.15 : 0.35 + (i / heights.length) * 0.65 }}
                  />
                ))}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
