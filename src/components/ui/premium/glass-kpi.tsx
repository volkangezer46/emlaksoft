import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { MiniBars } from "./mini-bars";
import { hasSeries } from "./premium-math";

/**
 * GlassKpi — HeroBanner içinde cam efektli KPI kutusu (yarı saydam + backdrop-blur).
 * `href` ZORUNLU (sıfır çıkmaz metrik). Sağ üstteki MiniBars yalnız GERÇEK seri
 * verilirse çizilir; yoksa yalnız ikon + değer. Etiket ve değer KISALMAZ: etiket
 * satır kırar, değer akıcı yazı boyutuyla kutuya sığar. `subTone`: alt satır dikkat
 * tonu ("danger" kırmızımsı, "warn" altın). Kutu sabit min-yükseklikte (CLS yok).
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
  const drawBars = hasSeries(series);
  return (
    <Link href={href} className="pm-glass focus-ring" data-series={drawBars ? "1" : undefined}>
      <span className="pm-glass-ico" aria-hidden="true">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="pm-glass-label block">{label}</span>
        <span className="pm-glass-value block">{value}</span>
        {sub ? (
          <span className="pm-glass-sub block" data-tone={subTone}>
            {sub}
          </span>
        ) : null}
      </span>
      {drawBars ? (
        <MiniBars data={series} onDark unit={seriesUnit} label={seriesLabel} width={48} height={26} className="pm-glass-bars" />
      ) : null}
    </Link>
  );
}
