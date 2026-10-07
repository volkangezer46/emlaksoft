import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { DataFreshness } from "@/components/ui/data-freshness";
import { HeroScene, type HeroSceneKind } from "@/components/ui/illustrations/hero-scenes";
import { DonutRing } from "@/components/ui/viz/donut-ring";
import { FunnelChart, type FunnelStage } from "@/components/ui/viz/funnel-chart";
import { formatViz, vizToneColor, type VizFormat, type VizTone } from "@/components/ui/viz/colors";
import type { PremiumTone } from "@/components/ui/premium/premium-math";

/**
 * Liste sayfası iskeleti (/app liste ekranları TEK yerleşim; referans /admin "Tüm ofisler").
 *
 *   <ListPage hero={{ eyebrow, title, description, art, actions }} kpis={<KpiStrip …/>}
 *             charts={<><DistributionCard …/><ColumnChartCard …/></>} toolbar={<ListToolbar …/>}>
 *     tablo / kart listesi / boş durum
 *   </ListPage>
 *
 * - Hepsi SUNUCU bileşeni: istemci JS yok (grafikler saf SVG/CSS, dilim/çubuk = bağlantı).
 * - Hero: eyebrow + büyük başlık (sayfadaki TEK h1) + özet + konu sahnesi (`HeroScene`) + eylemler; yüksekliği
 *   sınırlı (1366×768'de hero + KPI + grafik satırı ilk ekrana sığar), dar ekranda sahne gizlenir.
 * - Grafik kartları ~220 px; veri yoksa (toplam 0) kart HİÇ çizilmez (sahte grafik yok), satır boşsa satır da yok.
 * - Sıfır çıkmaz metrik: her dilim/çubuk/lejant satırı filtrelenmiş listeye gider (`href` zorunlu).
 * Stil: `src/app/list-page.css` (`lp-*`), derinlik dili `viz.css`.
 */

export type ListHeroProps = {
  /** Küçük harf aralıklı bağlam (ör. "Müşteri yönetimi"). */
  eyebrow?: string;
  title: string;
  /** Tek cümle özet (KPI'ları tekrar etmez). */
  description?: ReactNode;
  /** Konu sahnesi; verilmezse sahne çizilmez. */
  art?: HeroSceneKind;
  /** Birincil/ikincil eylemler (sağda). */
  actions?: ReactNode;
  /** Başlık yanında rozet (kapsam, sayaç). */
  meta?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  freshness?: boolean | string | number | Date;
  /** Sayfada üstte başka h1 varsa "h2". */
  as?: "h1" | "h2";
  className?: string;
};

export function ListHero({ eyebrow, title, description, art, actions, meta, breadcrumbs, freshness, as: Heading = "h1", className }: ListHeroProps) {
  return (
    <section className={cn("ds-hero lp-hero", className)} aria-label={title}>
      <div className="lp-hero-row">
        <div className="lp-hero-body">
          {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} className="mb-1.5" /> : null}
          {eyebrow ? <p className="ds-eyebrow lp-eyebrow">{eyebrow}</p> : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <Heading className="lp-hero-title">{title}</Heading>
            {meta}
          </div>
          {description ? <div className="lp-hero-summary">{description}</div> : null}
          {freshness ? <DataFreshness asOf={freshness === true ? undefined : freshness} className="mt-1" /> : null}
        </div>
        {art ? <HeroScene kind={art} className="lp-hero-art" /> : null}
        {actions ? <div className="lp-hero-actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function ListPage({
  hero,
  kpis,
  charts,
  notices,
  toolbar,
  children,
  footer,
  className,
}: {
  /** Verilmezse çağıran `<ListHero>`'yu ilk çocuk olarak yazar (yuvaların hepsi isteğe bağlı; sıra aynı kalır). */
  hero?: ListHeroProps;
  /** KPI şeridi (`KpiStrip` / `StatRow`). */
  kpis?: ReactNode;
  /** 1-2 grafik kartı (`DistributionCard`, `ColumnChartCard`, `FunnelCard`). */
  charts?: ReactNode;
  /** Grafik ile araç çubuğu arası bilgi kartları (hatırlatma, uyarı). */
  notices?: ReactNode;
  /** Arama + filtre çipleri (`ListToolbar`, `CategoryChips` …). */
  toolbar?: ReactNode;
  /** Tablo / kart listesi / boş durum. */
  children?: ReactNode;
  /** Sayfalama. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("lp space-y-4", className)}>
      {hero ? <ListHero {...hero} /> : null}
      {kpis}
      {charts ? <ListCharts>{charts}</ListCharts> : null}
      {notices}
      {toolbar}
      {children}
      {footer}
    </div>
  );
}

/** Grafik satırı: 1 kart tam genişlik, 2 kart yan yana (lg); boşsa CSS ile gizlenir. */
export function ListCharts({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("lp-charts", className)}>{children}</div>;
}

/** Gerçek veri var mı (toplam > 0)? Sayfa grafik satırını buna göre çizer. */
export function chartHasData(values: readonly { value: number }[]): boolean {
  return values.some((v) => Number.isFinite(v.value) && v.value > 0);
}

function ListChartFrame({
  title,
  subtitle,
  icon: Icon,
  tone = "brand",
  href,
  hrefLabel = "Tümü",
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("ds-card lp-chart", className)}>
      <header className="ds-head lp-chart-head">
        {Icon ? (
          <span className={`pm-ico pm-t-${tone}`} aria-hidden="true">
            <Icon />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="ds-title">{title}</h2>
          {subtitle ? <p className="ds-sub mt-0.5">{subtitle}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="ds-link focus-ring shrink-0">
            {hrefLabel} <ArrowUpRight aria-hidden="true" />
          </Link>
        ) : null}
      </header>
      <div className="lp-chart-body">{children}</div>
    </section>
  );
}

export type ChartSlice = { label: string; value: number; href: string; tone?: VizTone; color?: string };

const MAX_SLICES = 6;

/** 6'dan çok dilimde küçükleri "Diğer" altında toplar (hedefi çağıranın verdiği `otherHref`). */
function foldSlices(slices: readonly ChartSlice[], otherHref: string): ChartSlice[] {
  const clean = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (clean.length <= MAX_SLICES) return clean;
  const sorted = [...clean].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1).reduce((a, s) => a + s.value, 0);
  return [...head, { label: "Diğer", value: rest, href: otherHref, tone: "neutral" }];
}

/**
 * Dağılım kartı — halka + lejant (ad, sayı, yüzde). Dilim ve lejant satırı filtreli listeye gider.
 * Toplam 0 ise `null` (kart çizilmez).
 */
export function DistributionCard({
  title,
  subtitle,
  icon,
  tone,
  slices,
  href,
  centerLabel = "toplam",
  format = "number",
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  slices: readonly ChartSlice[];
  /** Kartın "Tümü" hedefi ve "Diğer" dilimi. */
  href: string;
  centerLabel?: string;
  format?: VizFormat;
  className?: string;
}) {
  const shown = foldSlices(slices, href);
  const total = shown.reduce((a, s) => a + s.value, 0);
  if (!(total > 0)) return null;
  const colored = shown.map((s, i) => ({ ...s, color: s.color ?? vizToneColor(s.tone, i) }));
  return (
    <ListChartFrame title={title} subtitle={subtitle} icon={icon} tone={tone} href={href} className={className}>
      <div className="lp-dist">
        <DonutRing segments={colored} size={128} stroke={18} ariaLabel={title} format={format} className="lp-dist-ring">
          <div>
            <p className="lp-dist-total">{formatViz(total, format === "money" ? "money" : "number")}</p>
            <p className="lp-dist-cap">{centerLabel}</p>
          </div>
        </DonutRing>
        <ul className="lp-legend">
          {colored.map((s) => (
            <li key={s.label}>
              <Link href={s.href} className="lp-legend-row focus-ring">
                <span className="lp-dot" style={{ background: s.color }} aria-hidden="true" />
                <span className="lp-legend-label">{s.label}</span>
                <span className="lp-legend-val">{formatViz(s.value, format)}</span>
                <span className="lp-legend-pct">%{Math.round((s.value / total) * 100)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </ListChartFrame>
  );
}

export type ChartBar = { label: string; value: number; href: string; title?: string };

/**
 * Sütun grafiği kartı — kategori ya da zaman kovası (hafta/gün). Her sütun bağlantıdır (filtreli liste);
 * değer sütunun üstünde, etiket altında yazılı (renge bağımlı değil). Hepsi 0 ise `null`.
 */
export function ColumnChartCard({
  title,
  subtitle,
  icon,
  tone,
  bars,
  href,
  barTone = "brand",
  format = "number",
  highlight,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  bars: readonly ChartBar[];
  href?: string;
  barTone?: VizTone;
  format?: VizFormat;
  /** Vurgulanan sütun dizini (ör. bugün / bu hafta) — altın. */
  highlight?: number;
  className?: string;
}) {
  if (!chartHasData(bars)) return null;
  const max = Math.max(...bars.map((b) => (Number.isFinite(b.value) ? b.value : 0)));
  const color = vizToneColor(barTone, 0);
  return (
    <ListChartFrame title={title} subtitle={subtitle} icon={icon} tone={tone} href={href} className={className}>
      <ol className="lp-cols" aria-label={title} style={{ "--lp-n": bars.length } as CSSProperties}>
        {bars.map((b, i) => {
          const v = Number.isFinite(b.value) ? Math.max(0, b.value) : 0;
          const pct = v > 0 ? Math.max(3, (v / max) * 100) : 0;
          return (
            <li key={`${b.label}-${i}`}>
              <Link href={b.href} className="lp-col focus-ring" title={b.title ?? `${b.label}: ${formatViz(v, format)}`}>
                <span className="lp-col-val">{formatViz(v, format)}</span>
                <span className="lp-col-track" aria-hidden="true">
                  <span
                    className="lp-col-bar viz-bar-fill"
                    style={{ height: `${pct}%`, backgroundColor: i === highlight ? "var(--viz-gold)" : color, "--viz-delay": `${i * 40}ms` } as CSSProperties}
                  />
                </span>
                <span className="lp-col-label">{b.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </ListChartFrame>
  );
}

/** Huni kartı — `FunnelChart` (aşama = filtreli liste). Hepsi 0 ise `null`. */
export function FunnelCard({
  title,
  subtitle,
  icon,
  tone,
  stages,
  href,
  ardisik = false,
  format = "number",
  barTone,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  stages: readonly FunnelStage[];
  href?: string;
  ardisik?: boolean;
  format?: VizFormat;
  barTone?: VizTone;
  className?: string;
}) {
  if (!chartHasData(stages)) return null;
  return (
    <ListChartFrame title={title} subtitle={subtitle} icon={icon} tone={tone} href={href} className={className}>
      <FunnelChart stages={stages} ardisik={ardisik} format={format} tone={barTone} ariaLabel={title} className="lp-funnel" />
    </ListChartFrame>
  );
}
