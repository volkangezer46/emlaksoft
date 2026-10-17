import Link from "@/components/ui/smart-link";
import type { ComponentType, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { countUpKind } from "@/components/ui/count-up-kind";
import { CountUpLazy } from "@/components/ui/count-up-lazy";
import { cn } from "@/lib/utils";
import { MiniBars } from "./mini-bars";
import { hasSeries, type PremiumTone, type Trend } from "./premium-math";
import { Sparkline } from "./sparkline";
import { TrendPill } from "./trend-pill";

/** Adet değeri CountUp ile aynı biçimde (TR binlik, tam sayı). */
const COUNT_NF = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * KpiTile — dashboard KPI kartının TEK uygulaması (KpiCard, StatCard ve KpiStrip bunu çizer).
 *
 * Anatomi: ikon kapsülü + etiket (13 px tek satır, sığmazsa üç nokta + `title`) + sağ ok; büyük değer (30 px, 600) + trend
 * rozeti; alt açıklama; yalnız GERÇEK seri varsa alt grafik. Aynı satırdaki kartlar ızgarada eşit
 * yükseklikte biter (`h-full`, grafik `mt-auto`).
 *
 * "Sıfır çıkmaz metrik": `href` verilirse kart Link olur. `KpiCard` (aşağıda) `href`'i ZORUNLU kılar;
 * `href`siz kullanım yalnız eski StatCard çağrıları içindir ve bilinçli olmalıdır.
 */
export type KpiTileProps = {
  label: string;
  /** Biçimlenmiş değer ("₺1.200.000") ya da sayı. */
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
  /** Tonlu zemin: tonun hafif degradesi + tonlu kenar (öne çıkan / dikkat kartı). */
  tinted?: boolean;
  /** Süzgeç kartı: bu kartın süzgeci şu an etkin (`aria-current`, etkin çip belirteci). */
  current?: boolean;
  /** Alt mini grafiğin yüksekliği (px; ince şerit 28). */
  chartHeight?: number;
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
  tinted = false,
  current = false,
  chartHeight = 36,
}: KpiTileProps) {
  const drawChart = hasSeries(series);
  const ico = iconNode ?? (Icon ? <Icon /> : null);
  const cls = cn(
    `pm-card pm-t-${tone} h-full`,
    layout === "inline" && "pm-card-inline",
    tinted && "pm-card-tint",
    href && "focus-ring group",
    // Sıfır/ikincil kart: soluk görünüm opaklıkla DEĞİL kenar + zemin tonuyla (metin kontrastı ≥ 4.5:1 kalır).
    dim && "pm-card-dim",
    current && "pm-card-on",
    className,
  );
  // Uzun biçimli tutar ("44.300.000 ₺") kartı taşırmasın: boyut küçülür, ₺ ayrılmaz boşlukla yapışır.
  const plainValue = typeof value === "string" ? value.replace(/ (?=₺)/g, "\u00a0") : value;
  // İlk görünümde bir kez sayar (CountUp: reduced-motion'da kapalı; sunucu çıktısı sonuç değeri; kısaltmalı/ondalıklı metin aynen kalır).
  // Para ve adet değerleri sayaç istemez (animasyonları kapalı): düz metin, istemci JS'i yok. Yalnız oran/ondalık tembel sayaç.
  const rawValue =
    typeof plainValue === "string" || typeof plainValue === "number" ? (
      countUpKind(plainValue, undefined, 0) === "other" ? (
        <CountUpLazy value={plainValue} />
      ) : (
        <span>{typeof plainValue === "number" ? COUNT_NF.format(plainValue) : plainValue}</span>
      )
    ) : (
      plainValue
    );
  const valueLen = typeof value === "string" ? value.length : typeof value === "number" ? String(Math.round(value)).length + 2 : 0;
  const valueCls = valueLen >= 14 ? "pm-value-long pm-value-xlong" : valueLen >= 9 ? "pm-value-long" : "";
  const valueStyle = attention ? { color: "var(--t-text)" } : undefined;

  const body =
    layout === "inline" ? (
      // Referans KPI düzeni: solda tonlu ikon karosu; başlık; değer + trend hapı ve sağda yumuşak alan çizgisi; alt bağlam.
      // Dar kartta (container query) önce çizgi gizlenir, ikon karosu KALIR.
      <>
        {ico ? (
          <span className="pm-ico" aria-hidden="true">
            {ico}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-start gap-1">
            <span className="pm-card-title" title={label}>
              {label}
            </span>
            {href ? <ChevronRight className="pm-card-arrow mt-0.5 h-4 w-4 max-sm:hidden" aria-hidden="true" /> : null}
          </span>
          <span className="mt-1 flex items-end gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn("pm-value", valueCls)} style={valueStyle}>
                {rawValue}
              </span>
              {trend ? <TrendPill trend={trend} /> : null}
            </span>
            {drawChart ? (
              <span className="pm-card-spark">
                {chart === "bars" ? (
                  <MiniBars data={series} tone={tone} unit={seriesUnit} label={seriesLabel} width={64} height={28} fluid />
                ) : (
                  <Sparkline data={series} tone={tone} unit={seriesUnit} label={seriesLabel} height={28} />
                )}
              </span>
            ) : null}
          </span>
          {previousText || hint ? <span className="pm-sub mt-0.5" title={typeof (previousText ?? hint) === "string" ? ((previousText ?? hint) as string) : undefined}>{previousText ?? hint}</span> : null}
        </span>
      </>
    ) : (
      <>
        <span className="pm-card-head">
          {ico ? (
            <span className="pm-ico" aria-hidden="true">
              {ico}
            </span>
          ) : null}
          <span className="pm-card-title" title={label}>
            {label}
          </span>
          {href ? <ChevronRight className="pm-card-arrow h-4 w-4 max-sm:hidden" aria-hidden="true" /> : null}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={cn("pm-value", valueCls)} style={valueStyle}>
            {rawValue}
          </span>
          {trend ? <TrendPill trend={trend} /> : null}
        </span>
        {previousText || hint ? <span className="pm-sub" title={typeof (previousText ?? hint) === "string" ? ((previousText ?? hint) as string) : undefined}>{previousText ?? hint}</span> : null}
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
    <Link href={href} title={title} className={cls} aria-current={current ? "true" : undefined}>
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
