/**
 * Ana ekran ortak küçük parçaları: panel bağlantısı ve Suspense iskeletleri. Elle çizilmiş mini grafikler (Sparkline,
 * TrendBadge) kaldırıldı (importer yoktu); grafikler tek setten gelir: `@/components/ui/viz` ve `ui/lazy-charts`.
 */
import Link from "next/link";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

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
      className={`space-y-2.5 rounded-[var(--pm-r)] border border-line bg-surface p-5 ${className}`}
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
      <Skeleton className={`${className} rounded-[var(--pm-r)]`} />
    </div>
  );
}
