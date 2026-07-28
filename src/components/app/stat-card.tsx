import Link from "next/link";
import { ArrowRight, ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { sparklineGeometry } from "@/lib/sparkline";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * StatCard — dashboard KPI kartı.
 *
 * Tıklanabilirlik standardı ("sıfır çıkmaz metrik"): her KPI bir yere gider.
 * `href` verildiğinde kart Link olur — hover'da ok ikonu + kenar vurgusu ile
 * tıklanabilirlik affordance'ı kazanır, klavye odağında focus-ring alır.
 *
 * v2 EKLERİ (hepsi opsiyonel, mevcut kullanımlar birebir aynı çalışır):
 *  - `trend` artık nesne de kabul eder: `{ value, direction, label }` →
 *    yeşil/kırmızı ok + yüzde rozeti. Eski `"up" | "down" | "neutral"` +
 *    `trendLabel` imzası aynen desteklenir.
 *  - `sparkline`: son N dönemin mini grafiği (paketsiz, saf SVG).
 *  - `tone`: `brand | mint | amber | warn | danger` takma adları eklendi.
 *  - `loading`: gerçek kartla aynı ölçüde iskelet hali.
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

const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-brand-600/10 text-brand-600",
  brand: "bg-brand-600/10 text-brand-600",
  success: "bg-mint-500/12 text-mint-700",
  mint: "bg-mint-500/12 text-mint-700",
  warning: "bg-amber-400/16 text-amber-700",
  warn: "bg-amber-400/16 text-amber-700",
  amber: "bg-amber-400/16 text-amber-700",
  danger: "bg-danger-500/10 text-danger-700",
};

/** Sparkline çizgi rengi — chip tonuyla aynı aile (grafik öğesi, 3:1 eşiği). */
const TONE_STROKE: Record<Tone, string> = {
  neutral: "var(--brand-600)",
  brand: "var(--brand-600)",
  success: "var(--mint-500)",
  mint: "var(--mint-500)",
  warning: "var(--amber-500)",
  warn: "var(--amber-500)",
  amber: "var(--amber-500)",
  danger: "var(--danger-500)",
};

const TONE_GLOW: Record<Tone, string> = {
  neutral: "kpi-glow-brand",
  brand: "kpi-glow-brand",
  success: "kpi-glow-mint",
  mint: "kpi-glow-mint",
  warning: "kpi-glow-amber",
  warn: "kpi-glow-warn",
  amber: "kpi-glow-amber",
  danger: "kpi-glow-danger",
};

/** Trend rozeti — yön oku + yüzde. Renk "iyi mi" bilgisinden gelir, yönden değil. */
function TrendPill({ trend }: { trend: StatTrend }) {
  const Icon =
    trend.direction === "down" ? TrendingDown : trend.direction === "neutral" ? ArrowRight : TrendingUp;
  const good = trend.good ?? trend.direction === "up";
  const cls =
    trend.direction === "neutral" ? "tone-neutral" : good ? "tone-success" : "tone-danger";
  const sign = trend.direction === "up" ? "+" : trend.direction === "down" ? "-" : "";
  return (
    <span className={`numeric inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>
      <Icon aria-hidden="true" className="h-3 w-3" />%{sign}
      {Math.abs(trend.value)}
    </span>
  );
}

/** Mini sparkline — `sparklineGeometry` (saf, test edilmiş) ile çizilir. */
function MiniSparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  const g = sparklineGeometry(data, { width: 100, height: 28, padding: 2 });
  return (
    <svg
      viewBox="0 0 100 28"
      className="mt-3 h-8 w-full overflow-visible"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`statspark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={g.area} fill={`url(#statspark-${id})`} />
      <polyline
        points={g.points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={g.last.x} cy={g.last.y} r="1.9" fill={color} />
    </svg>
  );
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
  animate = false,
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
  /** Girişte hafif yukarı+fade (reduced-motion altında kapanır). */
  animate?: boolean;
}) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" className="rounded-[18px] border border-line bg-surface p-5">
        <span className="sr-only">{label} yükleniyor</span>
        <div className="flex items-start justify-between">
          <Skeleton className="h-10 w-10 rounded-[12px]" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
        <Skeleton className="mt-4 h-3 w-24" />
        <Skeleton className="mt-2 h-7 w-20" />
        {sparkline ? <Skeleton className="mt-3 h-8 w-full" /> : null}
      </div>
    );
  }

  const normalized: StatTrend | null =
    typeof trend === "object" && trend !== null
      ? trend
      : null;

  const legacyTrendColor: Record<TrendDirection, string> = {
    up: "text-mint-700",
    down: "text-danger-700",
    neutral: "text-text-muted",
  };

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`kpi-chip-shine grid h-10 w-10 place-items-center rounded-[12px] ${TONE_CHIP[tone]}`}>
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="flex items-center gap-2">
          {normalized ? (
            <TrendPill trend={normalized} />
          ) : typeof trend === "string" && trendLabel ? (
            <span className={`text-xs font-semibold ${legacyTrendColor[trend]}`}>{trendLabel}</span>
          ) : null}
          {href && (
            <ArrowUpRight
              aria-hidden="true"
              className="h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100"
            />
          )}
        </span>
      </div>
      <p className="mt-4 text-sm text-text-muted">{label}</p>
      <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">{value}</p>
      {normalized?.label ? (
        <p className="mt-1 text-[11px] text-text-faint">{normalized.label}</p>
      ) : null}
      {sparkline && sparkline.length > 1 ? (
        <MiniSparkline
          data={sparkline}
          color={TONE_STROKE[tone]}
          // id yalnızca SVG gradient referansı için; etikete bağlamak kararlı
          // (render'lar arası değişmeyen) bir değer verir.
          id={label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "kpi"}
        />
      ) : null}
    </>
  );

  // kpi-glow: hover'da kartın altında ton renkli yumuşak parıltı (dashboard'da
  // kanıtlanmış sınıf). Taban sınıf + ton değişkeni birlikte verilmeli.
  const shell = `kpi-glow ${TONE_GLOW[tone]} rounded-[18px] border border-line bg-surface p-5${animate ? " anim-rise" : ""}`;

  if (href) {
    return (
      <Link href={href} className={`focus-ring press lift group block hover:border-brand-300 ${shell}`}>
        {inner}
      </Link>
    );
  }

  return <div className={`lift ${shell}`}>{inner}</div>;
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
    <div className={`rounded-[16px] border border-line bg-surface p-4 ${className ?? ""}`}>
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
