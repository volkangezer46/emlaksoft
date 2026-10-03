"use client";

import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";

/**
 * OSM gömülü harita: tembel yükleme + yükleme iskeleti + her zaman görünen "Haritayı aç" yedeği.
 * referrerPolicy: OSM karo sunucuları Referer ister; "no-referrer" iframe içindeki karo isteklerini de
 * kısıtlayıp haritayı boş gri bırakabilir, bu yüzden çapraz kökende yalnız origin gönderilir.
 */
export function MapEmbed({ src, openHref }: { src: string; openHref: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div>
      <div className="relative mt-3 h-64 w-full bg-ink-950/5 sm:h-72">
        {!loaded ? (
          <div className="absolute inset-0 grid animate-pulse place-items-center text-text-faint" aria-hidden="true">
            <MapPin className="h-8 w-8" />
          </div>
        ) : null}
        <iframe
          title="İlan konumu haritası"
          src={src}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          className="relative block h-full w-full border-0"
        />
      </div>
      <a
        href={openHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-5 py-3 text-xs font-semibold text-brand-600 hover:underline"
      >
        Haritayı aç <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
}
