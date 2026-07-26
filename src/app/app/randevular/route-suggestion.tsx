import Link from "next/link";
import { ExternalLink, MapPinned, Route } from "lucide-react";

/**
 * Rota önerisi — seçili günde koordinatlı 2+ yer gösterme varsa görünür.
 *
 * Basit en yakın komşu sıralaması: ilk durak günün en erken randevusu,
 * sonrakiler haversine mesafesine göre en yakın seçilir. Harita çizilmez;
 * çoklu durak yol tarifi Google Maps linkine devredilir.
 */

export type RouteStop = {
  appointmentId: string;
  propertyId: string;
  label: string;
  time: string; // ISO scheduled_at
  lat: number;
  lng: number;
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** En yakın komşu: en erken randevudan başla, kalanlardan hep en yakını al. */
function orderStops(stops: RouteStop[]): { ordered: RouteStop[]; totalKm: number } {
  const remaining = [...stops].sort((a, b) => a.time.localeCompare(b.time));
  const ordered: RouteStop[] = [remaining.shift()!];
  let totalKm = 0;
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    remaining.forEach((s, i) => {
      const d = haversineKm(last.lat, last.lng, s.lat, s.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    totalKm += bestDist;
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return { ordered, totalKm };
}

export function RouteSuggestion({ dateLabel, stops }: { dateLabel: string; stops: RouteStop[] }) {
  if (stops.length < 2) return null;

  const { ordered, totalKm } = orderStops(stops);
  const mapsHref = `https://www.google.com/maps/dir/${ordered.map((s) => `${s.lat},${s.lng}`).join("/")}`;

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
            <Route className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-brand-600">Rota önerisi</p>
            <h2 className="font-display font-bold text-ink-950">
              {dateLabel} — {ordered.length} durak · ~{totalKm < 1 ? "<1" : Math.round(totalKm)} km
            </h2>
          </div>
        </div>
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
        >
          <MapPinned className="h-3.5 w-3.5" /> Google Maps&apos;te yol tarifi
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <ol className="mt-4 space-y-1.5">
        {ordered.map((s, i) => (
          <li key={s.appointmentId} className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <span className="text-xs font-semibold tabular-nums text-text-muted">
              {new Date(s.time).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <Link
              href={`/app/portfoyler/${s.propertyId}`}
              className="min-w-0 truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600 hover:underline"
            >
              {s.label}
            </Link>
            {i > 0 ? (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-faint">
                +{haversineKm(ordered[i - 1].lat, ordered[i - 1].lng, s.lat, s.lng).toFixed(1)} km
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] text-text-faint">
        Sıralama kuş uçuşu (haversine) en yakın komşuya göredir; ilk durak günün en erken randevusudur.
      </p>
    </section>
  );
}
