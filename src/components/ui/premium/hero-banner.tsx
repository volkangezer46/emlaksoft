import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CityNight } from "./city-night";

/**
 * HeroBanner — lacivert gradient karşılama bandı (premium konsol). Her iki temada
 * lacivert kalır; içindeki metin sabit açık/altın (kontrast testlidir). Sağda elle
 * çizilmiş saf-SVG gece şehri; hareket azaltma tercihinde animasyonsuz.
 *
 * Slotlar: `eyebrow` (küçük üst etiket, ör. "3 EKİM CUMARTESİ · GENEL BAKIŞ"),
 * `title` + `highlight` (başlık; `highlight` altın renkte, ör. kullanıcı adı),
 * `summary` (tek cümle özet; ReactNode — Suspense ile akabilir), `actions` (sağ üst:
 * PeriodToggle, düğmeler), `children` (alttaki KPI ızgarası; GlassKpi'ler).
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
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-full flex-1 basis-80">
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
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div> : null}
    </section>
  );
}
