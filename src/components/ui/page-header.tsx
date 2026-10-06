import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { DataFreshness } from "@/components/ui/data-freshness";

/**
 * PageHeader — /app ve /admin için TEK sayfa başlığı.
 *
 * Eski düzende her sayfa kendi koyu gradient "hero" bandını kopyalıyordu
 * (~80 sayfa); başlık, açıklama ve aksiyon dizilimi sayfadan sayfaya
 * değişiyor, veri ekranın altına itiliyordu. Bu bileşen sakin, tek satırlık
 * bir başlık verir: breadcrumb → başlık + durum → açıklama; sağda aksiyonlar.
 * Yalnız token kullanır (dark modda otomatik uyum).
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  meta,
  icon,
  freshness,
  className,
  as: Heading = "h1",
}: {
  title: string;
  description?: ReactNode;
  /** Başlığın üstünde küçük bağlam etiketi (ör. modül adı). */
  eyebrow?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** Sağ üst: birincil/ikincil düğmeler. */
  actions?: ReactNode;
  /** Başlığın yanında: rozet, sayaç vb. */
  meta?: ReactNode;
  /** Başlığın solunda: ikon veya avatar. */
  icon?: ReactNode;
  /** "Son güncelleme SS:DD · Taze" damgası: true = bu istekte okundu, değer = verinin gerçek zamanı. */
  freshness?: boolean | string | number | Date;
  className?: string;
  /** Başlık düzeyi: sayfada üstte DashboardHero (tek h1) varsa "h2". */
  as?: "h1" | "h2";
}) {
  return (
    // Eylemler BAŞLIK SATIRIYLA aynı hizada (breadcrumb/eyebrow üstte, açıklama altta tam genişlik);
    // dar ekranda başlığın altına sarar.
    <header className={cn("mb-5", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} className="mb-2" /> : null}
      <div className={cn("min-w-0", icon ? "flex items-start gap-3" : undefined)}>
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Heading className="font-display text-2xl font-bold tracking-tight text-text">{title}</Heading>
              {meta}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
          {description ? <div className="mt-1 max-w-3xl text-sm text-text-muted">{description}</div> : null}
          {freshness ? <DataFreshness asOf={freshness === true ? undefined : freshness} className="mt-1.5" /> : null}
        </div>
      </div>
    </header>
  );
}
