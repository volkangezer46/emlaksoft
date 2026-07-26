import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Stat card component for dashboards.
 *
 * Tıklanabilirlik standardı ("sıfır çıkmaz metrik"): her KPI bir yere gider.
 * `href` verildiğinde kart Link olur — hover'da ok ikonu + kenar vurgusu ile
 * tıklanabilirlik affordance'ı kazanır, klavye odağında focus-ring alır.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendLabel,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  /** Kartın drill-down hedefi (örn. /app/komisyon?durum=bekleyen) */
  href?: string;
}) {
  const toneClasses = {
    neutral: "bg-brand-600/10 text-brand-600",
    success: "bg-mint-500/10 text-mint-600",
    warning: "bg-amber-400/10 text-amber-600",
    danger: "bg-danger-500/10 text-danger-500",
  };

  const trendColors = {
    up: "text-mint-600",
    down: "text-danger-500",
    neutral: "text-text-muted",
  };

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className={`grid h-10 w-10 place-items-center rounded-[12px] ${toneClasses[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="flex items-center gap-2">
          {trend && trendLabel && (
            <span className={`text-xs font-semibold ${trendColors[trend]}`}>{trendLabel}</span>
          )}
          {href && (
            <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
          )}
        </span>
      </div>
      <p className="mt-4 text-sm text-text-muted">{label}</p>
      <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="focus-ring press lift group block rounded-[18px] border border-line bg-surface p-5 hover:border-brand-300"
      >
        {inner}
      </Link>
    );
  }

  return <div className="lift rounded-[18px] border border-line bg-surface p-5">{inner}</div>;
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
