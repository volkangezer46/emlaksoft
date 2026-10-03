import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CityNight } from "./city-night";

/**
 * HeroBanner — lacivert, çok katmanlı karşılama bandı (premium konsol). Her iki temada
 * lacivert kalır; içindeki metin sabit açık/altın (kontrast testlidir). Sağda elle
 * çizilmiş saf-SVG gece şehri (CityNight); hareket azaltma tercihinde animasyonsuz.
 *
 * Yerleşim: sol sütunda eyebrow, başlık, özet ve `actions` satırı (görselle çakışmaz;
 * görsel yalnız sağ üst/orta alanı kaplar); altta `children` (GlassKpi ızgarası).
 * Slotlar: `eyebrow`, `title` + `highlight` (altın vurgu), `summary` (ReactNode —
 * Suspense ile akabilir), `actions`, `children`.
 */
export function HeroBanner({
  eyebrow,
  title,
  highlight,
  summary,
  actions,
  children,
  className,
}: {
  eyebrow: ReactNode;
  title: string;
  highlight?: string;
  summary?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("pm-hero", className)} aria-labelledby="pm-hero-title">
      <CityNight className="pm-hero-art" />
      <div className="pm-hero-body">
        <p className="pm-hero-eyebrow">{eyebrow}</p>
        <h1 id="pm-hero-title" className="pm-hero-title">
          {title}
          {highlight ? (
            <>
              , <em>{highlight}</em>
            </>
          ) : null}
        </h1>
        {summary ? <div className="pm-hero-summary">{summary}</div> : null}
        {actions ? <div className="pm-hero-actions">{actions}</div> : null}
      </div>
      {children ? <div className="pm-hero-kpis">{children}</div> : null}
    </section>
  );
}
