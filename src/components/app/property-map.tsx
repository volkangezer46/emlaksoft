import { MapPin, ExternalLink } from "lucide-react";

/**
 * İnteraktif konum haritası — OpenStreetMap embed (ücretsiz, API anahtarı/dependency gerektirmez).
 * lat/lng varsa işaretli interaktif harita; yoksa adresle Google Maps arama linki.
 */
export function PropertyMap({
  lat,
  lng,
  label,
  addressQuery,
  height = 320,
}: {
  lat?: number | null;
  lng?: number | null;
  label?: string;
  addressQuery?: string | null;
  height?: number;
}) {
  const hasCoords = typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng);

  if (hasCoords) {
    const d = 0.008; // ~1km bbox
    const bbox = `${(lng! - d).toFixed(5)},${(lat! - d).toFixed(5)},${(lng! + d).toFixed(5)},${(lat! + d).toFixed(5)}`;
    const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
    const osmLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    const gmapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    return (
      <div className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <iframe
          title={label ? `${label} konumu` : "Konum haritası"}
          src={embed}
          loading="lazy"
          className="w-full"
          style={{ height, border: 0 }}
        />
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 text-text-muted">
            <MapPin className="h-3.5 w-3.5 text-brand-600" />
            {label ?? "Konum"}
          </span>
          <span className="flex items-center gap-3">
            <a href={osmLink} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">OSM</a>
            <a href={gmapsLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
              Google Maps <ExternalLink className="h-3 w-3" />
            </a>
          </span>
        </div>
      </div>
    );
  }

  // Koordinat yok → adresle arama linki
  if (addressQuery) {
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`;
    return (
      <div className="rounded-[16px] border border-dashed border-line-strong bg-surface p-5 text-center">
        <MapPin className="mx-auto h-7 w-7 text-text-faint" />
        <p className="mt-2 text-sm text-text-muted">Bu portföy için harita koordinatı girilmemiş.</p>
        <a href={gmaps} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-brand-600 transition hover:border-brand-300">
          Adresi Google Maps’te ara <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  return null;
}
