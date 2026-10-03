import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { MiniBars } from "./mini-bars";
import { hasSeries } from "./premium-math";

/**
 * GlassKpi — HeroBanner içinde cam efektli KPI kutusu (yarı saydam + backdrop-blur).
 * `href` ZORUNLU (sıfır çıkmaz metrik). Sağdaki MiniBars yalnız GERÇEK seri verilirse
 * çizilir. `subTone`: alt satır dikkat tonu ("danger" kırmızımsı, "warn" altın).
 */
export function GlassKpi({
  label,
  value,
  sub,
  subTone,
  href,
  icon: Icon,
  series,
  seriesUnit,
  seriesLabel,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: "danger" | "warn";
  href: string;
  icon: ComponentType<{ className?: string }>;
  series?: readonly number[];
  seriesUnit?: string;
  seriesLabel?: string;
}) {
  return (
    <Link href={href} className="pm-glass focus-ring">
      <span className="pm-glass-ico" aria-hidden="true">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="pm-glass-label block truncate">{label}</span>
        <span className="pm-glass-value block truncate">{value}</span>
        {sub ? (
          <span className="pm-glass-sub block truncate" data-tone={subTone}>
            {sub}
          </span>
        ) : null}
      </span>
      {hasSeries(series) ? (
        <MiniBars data={series} onDark unit={seriesUnit} label={seriesLabel} width={52} height={34} className="hidden sm:block" />
      ) : null}
    </Link>
  );
}
