import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { sparklineGeometry } from "@/lib/sparkline";
import { Skeleton, SkeletonRow } from "@/components/app/skeleton";
import type { TrendInfo } from "./helpers";

export const toneText: Record<string, string> = {
  danger: "text-danger-500",
  warn: "text-warn-500",
  amber: "text-amber-500",
  mint: "text-mint-600",
  brand: "text-brand-600",
};
export const toneBg: Record<string, string> = {
  danger: "bg-danger-500/10 text-danger-500",
  warn: "bg-warn-500/10 text-warn-500",
  amber: "bg-amber-400/15 text-amber-500",
  mint: "bg-mint-500/12 text-mint-600",
  brand: "bg-brand-600/10 text-brand-600",
};

export function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  // Geometri `src/lib/sparkline.ts` (saf, vitest kapsamında) — StatCard ile ortak.
  const { points: line, area, last } = sparklineGeometry(data, { width: 100, height: 28, padding: 2 });
  return (
    <svg viewBox="0 0 100 28" className="h-8 w-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#spark-${id})`} />
      <polyline
        className="chart-draw"
        style={{ "--len": 240 } as React.CSSProperties}
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r="1.9" fill={color} />
    </svg>
  );
}

/** Dönem karşılaştırma rozeti: yeşil ↑ / kırmızı ↓ / nötr → ("yeni" KPI tonunda). */
export function TrendBadge({ trend, tone }: { trend: TrendInfo; tone?: string }) {
  const Icon = trend.dir === "down" ? TrendingDown : trend.dir === "flat" ? ArrowRight : TrendingUp;
  const cls =
    trend.dir === "new"
      ? toneText[tone ?? "brand"]
      : trend.dir === "flat"
        ? "text-text-muted"
        : trend.good
          ? "text-mint-600"
          : "text-danger-500";
  return (
    <span className={`flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs font-semibold tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" /> {trend.label}
    </span>
  );
}

/** Panel kartı başlığının sağındaki bağlantı ("Tümü ↗" vb.). */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-brand-600"
    >
      {children}
    </Link>
  );
}

/* ------------------------------- İskeletler -------------------------------- */

/** Suspense yedeği: panel kartı iskeleti (başlık + satırlar). */
export function PanelIskelet({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={`space-y-2.5 rounded-[var(--radius-panel)] border border-line bg-surface p-5 ${className}`}
    >
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function BlokIskelet({ className = "h-56" }: { className?: string }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className={`${className} rounded-[var(--radius-panel)]`} />
    </div>
  );
}
