"use client";

import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";

/**
 * OSM gömülü harita — DOKUNUŞLA yüklenir (SK8 B046): ilk açılışta yalnız hafif bir kart çizilir; OSM'nin iframe'i ve
 * karo/JS istekleri kullanıcı "Haritayı göster"e dokunana dek hiç başlamaz (LCP ve veri tasarrufu). Her zaman görünen
 * "Haritayı aç" yedeği vardır.
 *
 * Konum gizliliği (B152): `approximate` iken haritada işaret yoktur; merkezde yaklaşık daire çizilir (koordinat
 * `public-location.ts`'te 3 ondalığa yuvarlanmış ve kaydırılmıştır, kutu merkezi = daire merkezi).
 * referrerPolicy: OSM karo sunucuları Referer ister; çapraz kökende yalnız origin gönderilir.
 */
export function MapEmbed({
  src,
  openHref,
  areaLabel,
  approximate,
}: {
  src: string;
  openHref: string;
  areaLabel: string;
  approximate: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div>
      <div className="relative mt-3 h-64 w-full overflow-hidden bg-ink-950/5 sm:h-72">
        {shown ? (
          <>
            {!loaded ? (
              <div className="absolute inset-0 grid animate-pulse place-items-center text-text-faint" aria-hidden="true">
                <MapPin className="h-8 w-8" />
              </div>
            ) : null}
            <iframe
              title="İlan konumu haritası (yaklaşık)"
              src={src}
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoaded(true)}
              className="relative block h-full w-full border-0"
            />
            {approximate ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-600/70 bg-brand-600/15"
              />
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShown(true)}
            className="focus-ring absolute inset-0 grid w-full place-items-center bg-canvas text-center transition hover:bg-ink-950/5"
          >
            <span>
              <MapPin className="mx-auto h-8 w-8 text-brand-600" aria-hidden="true" />
              <span className="mt-2 block text-sm font-bold text-ink-950">Haritayı göster</span>
              <span className="mt-0.5 block px-4 text-xs text-text-muted">
                {areaLabel ? `${areaLabel} · ` : ""}
                {approximate ? "yaklaşık konum" : "konum"}
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        {approximate ? (
          <p className="text-xs text-text-muted">Gizlilik için konum mahalle düzeyinde, yaklaşık gösterilir.</p>
        ) : (
          <span />
        )}
        <a
          href={openHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
        >
          Haritayı aç <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
