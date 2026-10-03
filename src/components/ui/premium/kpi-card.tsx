import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniBars } from "./mini-bars";
import { hasSeries, type PremiumTone, type Trend } from "./premium-math";
import { Sparkline } from "./sparkline";
import { TrendPill } from "./trend-pill";

/**
 * KpiTile — dashboard KPI kartının TEK uygulaması (KpiCard, StatCard ve KpiStrip bunu çizer).
 *
 * Anatomi: ikon kapsülü + etiket (2 satıra kadar sarar, kırpılmaz) + sağ ok; büyük değer + trend
 * rozeti; alt açıklama; yalnız GERÇEK seri varsa alt grafik. Aynı satırdaki kartlar ızgarada eşit
 * yükseklikte biter (`h-full`, grafik `mt-auto`).
 *
 * "Sıfır çıkmaz metrik": `href` verilirse kart Link olur. `KpiCard` (aşağıda) `href`'i ZORUNLU kılar;
 * `href`siz kullanım yalnız eski StatCard çağrıları içindir ve bilinçli olmalıdır.
 */
export type KpiTileProps = {
  label: string;
  /** Biçimlenmiş değer ("₺1,2 Mn") ya da sayı. */
  value: ReactNode;
  href?: string;
  /** İkon bileşeni (lucide) ya da hazır düğüm; ikisinden biri. */
  icon?: ComponentType<{ className?: string }>;
  iconNode?: ReactNode;
  tone?: PremiumTone;
  /** `computeTrend(...)` çıktısı. */
  trend?: Trend;
  /** "Önceki dönem 6" gibi karşılaştırma metni; yoksa `hint`. */
  previousText?: string;
  /** Trend yokken alt açıklama (ör. "1 talepte SLA aşıldı"). */
  hint?: ReactNode;
  /** Değer vurgusu: dikkat gerektiriyorsa değer ton renginde. */
  attention?: boolean;
  /** Değer sıfırken kartı sönük çiz (yine tıklanabilir). */
  dim?: boolean;
  /** Gerçek geçmiş seri (en eski → en yeni). */
  series?: readonly number[];
  chart?: "line" | "bars";
  /** Seri birimi ("hafta", "ay") — erişilebilir özet için. */
  seriesUnit?: string;
  /** Erişilebilir grafik özeti (verilmezse seriden üretilir). */
  seriesLabel?: string;
  /** Fare üstü açıklaması. */
  title?: string;
  className?: string;
  /** "inline": ikon kapsülü solda, değer + trend ortada, mini çubuklar sağda (yoğun ana ekran düzeni). */
  layout?: "stack" | "inline";
};

export function KpiTile({
  label,
  value,
  href,
  icon: Icon,
  iconNode,
  tone = "brand",
  trend,
  previousText,
  hint,
  attention = false,
  dim = false,
  series,
  chart = "line",
  seriesUnit,
  seriesLabel,
  title,
  className,
  layout = "stack",
}: KpiTileProps) {
  const drawChart = hasSeries(series);
  const ico = iconNode ?? (Icon ? <Icon /> : null);
  const cls = cn(
    `pm-card pm-t-${tone} h-full`,
    layout === "inline" && "pm-card-inline",
    href && "focus-ring group",
    dim && "opacity-70 hover:opacity-100",
    className,
  );
  // Uzun biçimli tutar ("44.300.000 ₺") kartı taşırmasın: boyut küçülür, ₺ ayrılmaz boşlukla yapışır.
  const rawValue = typeof value === "string" ? value.replace(/ (?=₺)/g, "\u00a0") : value;
  const valueCls = typeof value === "string" && value.length >= 11 ? "pm-value-long" : "";
  const valueStyle = attention ? { color: "var(--t-text)" } : undefined;

  const body =
    layout === "inline" ? (
      <>
        {ico ? (
          <span className="pm-ico pm-ico-lg" aria-hidden="true">
            {ico}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="pm-card-title line-clamp-2 break-words" title={label}>
            {label}
          </span>
          <span className={cn("pm-value mt-0.5 block", valueCls)} style={valueStyle}>
            {rawValue}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {trend ? <TrendPill trend={trend} /> : null}
            {previousText || hint ? <span className="pm-sub">{previousText ?? hint}</span> : null}
          </span>
        </span>
        {drawChart ? (
          <MiniBars data={series} tone={tone} unit={seriesUnit} label={seriesLabel} width={64} height={44} className="pm-card-bars" />
        ) : null}
      </>
    ) : (
      <>
        <span className="pm-card-head">
          {ico ? (
            <span className="pm-ico" aria-hidden="true">
              {ico}
            </span>
          ) : null}
          <span className="pm-card-title line-clamp-2 break-words" title={label}>
            {label}
          </span>
          {href ? <ChevronRight className="pm-card-arrow h-4 w-4" aria-hidden="true" /> : null}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={cn("pm-value", valueCls)} style={valueStyle}>
            {rawValue}
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
      </>
    );

  if (!href) {
    return (
      <div className={cls} title={title}>
        {body}
      </div>
    );
  }
  return (
    <Link href={href} title={title} className={cls}>
      {body}
    </Link>
  );
}

/** KpiCard — `href` ZORUNLU (sıfır çıkmaz metrik). Gerisi `KpiTile` ile aynı. */
export type KpiCardProps = Omit<KpiTileProps, "href" | "icon"> & {
  href: string;
  icon: ComponentType<{ className?: string }>;
};

export function KpiCard(props: KpiCardProps) {
  return <KpiTile {...props} />;
}
