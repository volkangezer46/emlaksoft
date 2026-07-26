"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Minus, Plus } from "lucide-react";

/**
 * Günün rotası haritası — portföy haritasıyla (portfoyler/map-view.tsx) ve
 * talep-arz haritasıyla birebir aynı teknik: OSM raster karoları + elle
 * Web Mercator projeksiyonu; ek paket ve API anahtarı yok.
 *
 * Fark: koordinatlı duraklar SIRA NUMARALI marker olarak basılır ve
 * aralarına saat sırasında düz çizgi (SVG polyline) çizilir — rota kuş
 * uçuşudur, yol ağı takip edilmez (alttaki listede km zaten yazar).
 */

export type RotaMarker = {
  id: string;
  /** Listedeki durak numarası (1 tabanlı, saat sırası). */
  order: number;
  label: string;
  /** "09:30" — server'da formatlanmış saat (hydration güvenli). */
  timeLabel: string;
  lat: number;
  lng: number;
  /** Portföy detayına gider; portföysüz koordinat olmayacağı için hep dolu. */
  href: string | null;
};

const TILE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 17;
const MAP_HEIGHT = 380;

function lngToX(lng: number) {
  return (lng + 180) / 360;
}

function latToY(lat: number) {
  const r = (lat * Math.PI) / 180;
  return Math.min(1, Math.max(0, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2));
}

export function RotaMap({ markers }: { markers: RotaMarker[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(12);
  const [center, setCenter] = useState({ x: lngToX(35.2), y: latToY(39.0) });
  const [activeId, setActiveId] = useState<string | null>(null);

  const points = useMemo(
    () => markers.map((m) => ({ ...m, wx: lngToX(m.lng), wy: latToY(m.lat) })),
    [markers],
  );

  // Konteyner genişliğini izle
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Durak kümesi değişince haritayı bir kez sığdır (kullanıcı gezinmesini ezme)
  const fittedFor = useRef("");
  useEffect(() => {
    if (!width || points.length === 0) return;
    const key = points.map((p) => p.id).join(",");
    if (fittedFor.current === key) return;
    fittedFor.current = key;

    const xs = points.map((p) => p.wx);
    const ys = points.map((p) => p.wy);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    let z = MAX_ZOOM;
    while (z > MIN_ZOOM) {
      const scale = TILE * 2 ** z;
      if ((maxX - minX) * scale <= width - 120 && (maxY - minY) * scale <= MAP_HEIGHT - 120) break;
      z -= 1;
    }
    // Tek durakta bounds sıfırdır → sokak ölçeğine sabitle
    setZoom(points.length === 1 ? 14 : z);
    setCenter({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }, [width, points]);

  // Sürükleyerek kaydırma — hareket eşiği aşılmadıysa tıklama sayılır (popup kapat)
  const drag = useRef<{ px: number; py: number; cx: number; cy: number; moved: boolean } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = { px: e.clientX, py: e.clientY, cx: center.x, cy: center.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    const scale = TILE * 2 ** zoom;
    setCenter({
      x: d.cx - dx / scale,
      y: Math.min(1, Math.max(0, d.cy - dy / scale)),
    });
  }

  function onPointerUp() {
    if (drag.current && !drag.current.moved) setActiveId(null);
    drag.current = null;
  }

  const scale = TILE * 2 ** zoom;
  const n = 2 ** zoom;
  const originX = center.x * scale - width / 2;
  const originY = center.y * scale - MAP_HEIGHT / 2;

  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  if (width > 0) {
    const tx0 = Math.floor(originX / TILE);
    const tx1 = Math.floor((originX + width) / TILE);
    const ty0 = Math.max(0, Math.floor(originY / TILE));
    const ty1 = Math.min(n - 1, Math.floor((originY + MAP_HEIGHT) / TILE));
    for (let tx = tx0; tx <= tx1; tx += 1) {
      const wrapX = ((tx % n) + n) % n;
      for (let ty = ty0; ty <= ty1; ty += 1) {
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrapX}/${ty}.png`,
          left: tx * TILE - originX,
          top: ty * TILE - originY,
        });
      }
    }
  }

  // Piksel konumları — hem marker hem polyline aynı hesabı kullanır
  const px = points.map((p) => ({ ...p, x: p.wx * scale - originX, y: p.wy * scale - originY }));
  const activePoint = px.find((p) => p.id === activeId) ?? null;

  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <div
        ref={boxRef}
        className="relative w-full cursor-grab touch-none select-none overflow-hidden bg-canvas active:cursor-grabbing"
        style={{ height: MAP_HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="Günün rotası haritası"
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element -- OSM karoları; next/image remote domain konfigürasyonu gerektirir
          <img
            key={t.key}
            src={t.src}
            alt=""
            width={TILE}
            height={TILE}
            draggable={false}
            loading="lazy"
            className="pointer-events-none absolute max-w-none"
            style={{ left: t.left, top: t.top }}
          />
        ))}

        {/* Duraklar arası düz çizgi — saat sırasında, kuş uçuşu */}
        {width > 0 && px.length >= 2 ? (
          <svg
            className="pointer-events-none absolute inset-0 z-[5] text-brand-600"
            width={width}
            height={MAP_HEIGHT}
            aria-hidden
          >
            <polyline
              points={px.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeDasharray="7 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />
          </svg>
        ) : null}

        {px.map((p) => {
          if (p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > MAP_HEIGHT + 60) return null;
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setActiveId(active ? null : p.id)}
              className={`absolute z-10 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand-600 text-[13px] font-extrabold text-white shadow-[0_2px_8px_rgba(20,99,255,0.45)] ring-2 ring-white transition-transform hover:scale-110 ${active ? "scale-110" : ""}`}
              style={{ left: p.x, top: p.y }}
              aria-label={`Durak ${p.order}: ${p.label} — ${p.timeLabel}`}
              title={`${p.order}. ${p.label} · ${p.timeLabel}`}
            >
              {p.order}
            </button>
          );
        })}

        {activePoint ? (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-[220px] -translate-x-1/2 -translate-y-full rounded-[12px] border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
            style={{
              left: Math.min(Math.max(activePoint.x, 115), Math.max(width - 115, 115)),
              top: Math.max(activePoint.y - 24, 92),
            }}
          >
            <p className="text-xs font-semibold tabular-nums text-text-muted">
              {activePoint.order}. durak · {activePoint.timeLabel}
            </p>
            <p className="mt-0.5 truncate text-sm font-bold text-ink-950">{activePoint.label}</p>
            {activePoint.href ? (
              <Link
                href={activePoint.href}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
              >
                Portföyü aç <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="absolute right-3 top-3 z-20 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
            className="grid h-8 w-8 place-items-center text-ink-950 transition hover:bg-canvas"
            aria-label="Yakınlaştır"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
            className="grid h-8 w-8 place-items-center border-t border-line text-ink-950 transition hover:bg-canvas"
            aria-label="Uzaklaştır"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs">
        <span className="text-text-muted">
          Çizgi kuş uçuşudur; sıralama randevu saatine göredir.
        </span>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-faint hover:underline"
        >
          © OpenStreetMap katkıda bulunanlar
        </a>
      </div>
    </div>
  );
}
