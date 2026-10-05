import { cn } from "@/lib/utils";

/**
 * SkeletonCard — içerikle eşleşen SABİT yükseklikte iskelet (CLS yok). Parlama motion.css
 * `.skeleton` (reduced-motion'da durağan). Grafik gövdesi için `variant="chart"` (varsayılan),
 * kart için `variant="card"` (başlık + satırlar).
 */
export function SkeletonCard({
  height = 176,
  variant = "chart",
  lines = 3,
  label = "Yükleniyor",
  className,
}: {
  /** px (sayı) ya da CSS değeri ("100%"). İçerik yüksekliğiyle eşleştir. */
  height?: number | string;
  variant?: "chart" | "card";
  lines?: number;
  label?: string;
  className?: string;
}) {
  if (variant === "chart") {
    return (
      <div role="status" aria-label={label} className={cn("skeleton w-full rounded-[var(--radius-control)]", className)} style={{ height }} />
    );
  }
  return (
    <div role="status" aria-label={label} className={cn("flex w-full flex-col gap-3", className)} style={{ height }}>
      <div className="skeleton h-4 w-1/3 rounded-[var(--radius-control)]" />
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div key={i} className="skeleton h-3 rounded-[var(--radius-control)]" style={{ width: `${92 - i * 14}%` }} />
      ))}
      <div className="skeleton min-h-0 flex-1 rounded-[var(--radius-control)]" />
    </div>
  );
}
