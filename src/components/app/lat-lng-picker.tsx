"use client";

import { useState } from "react";
import { Crosshair, Loader2, MapPin } from "lucide-react";

/**
 * Enlem/boylam girişi + tarayıcı konumu + haritadan bulma linki.
 * Native form içinde `name="lat"` / `name="lng"` ile gönderilir.
 */
export function LatLngPicker({
  defaultLat,
  defaultLng,
  fieldClass,
}: {
  defaultLat?: number | null;
  defaultLng?: number | null;
  fieldClass?: string;
}) {
  const [lat, setLat] = useState(defaultLat != null ? String(defaultLat) : "");
  const [lng, setLng] = useState(defaultLng != null ? String(defaultLng) : "");
  const [busy, setBusy] = useState(false);
  const cls = fieldClass ?? "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setBusy(false);
      },
      () => setBusy(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const osmPick =
    lat && lng
      ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
      : "https://www.openstreetmap.org/";

  return (
    <div className="sm:col-span-2">
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-950">
        <MapPin className="h-3.5 w-3.5 text-brand-600" /> Konum (harita için)
        <span className="font-normal text-text-faint">— opsiyonel</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="lat"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          inputMode="decimal"
          placeholder="Enlem (ör. 37.5753)"
          className={`min-w-0 flex-1 ${cls}`}
        />
        <input
          name="lng"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          inputMode="decimal"
          placeholder="Boylam (ör. 36.9228)"
          className={`min-w-0 flex-1 ${cls}`}
        />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line px-3 py-2.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
          Konumumu kullan
        </button>
      </div>
      <a href={osmPick} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] font-semibold text-brand-600 hover:underline">
        Haritada bul / doğrula →
      </a>
    </div>
  );
}
