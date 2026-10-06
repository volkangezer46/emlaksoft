import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CitySkyline } from "@/components/ui/illustrations";
import { HeroPlay } from "@/components/ui/hero-play";

/**
 * DashboardHero — panel karşılama bandı (tasarım sistemi v4): üstte küçük harf aralıklı tarih
 * satırı (`eyebrow`), büyük selamlama (`title`, sayfadaki TEK h1), tek cümle özet (`summary`,
 * Suspense ile akabilir; KPI'ları TEKRARLAMAZ), tazelik damgası (`freshness`), sağda dönem
 * seçici yuvası (`aside`). Zemin açık ve havadar; sağda soluk mavi izometrik şehir
 * (`CitySkyline`); çok hafif hareketli degrade YALNIZ burada (CSS transform, ekran dışında
 * durur, reduce'ta yok). Koyu temada token'larla uyumlu.
 */
export function DashboardHero({
  eyebrow,
  title,
  summary,
  freshness,
  aside,
  art = true,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  freshness?: ReactNode;
  aside?: ReactNode;
  art?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("ds-hero", className)} aria-labelledby="ds-hero-title">
      <span className="ds-hero-ambient" aria-hidden="true" />
      {art ? <CitySkyline className="ds-hero-art" /> : null}
      <HeroPlay />
      <div className="ds-hero-row">
        <div className="ds-hero-body">
          <p className="ds-eyebrow">{eyebrow}</p>
          <h1 id="ds-hero-title" className="ds-hero-title">
            {title}
          </h1>
          {summary ? <div className="ds-hero-summary">{summary}</div> : null}
          {freshness ? <div className="mt-2">{freshness}</div> : null}
        </div>
        {aside ? <div className="relative shrink-0">{aside}</div> : null}
      </div>
    </section>
  );
}
