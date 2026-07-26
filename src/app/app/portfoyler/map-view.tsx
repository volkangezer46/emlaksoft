"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, MapPin, MapPinOff, Minus, Plus } from "lucide-react";

/**
 * Çoklu pin portföy haritası — OSM raster karoları + Web Mercator projeksiyonu.
 *
 * Tek portföy haritası (property-map.tsx) OSM iframe embed kullanıyor; embed
 * yalnızca TEK marker parametresi destekliyor, çoklu pin çizemiyor. Bu yüzden
 * aynı kaynağın (OpenStreetMap) karo sunucusundan tile'ları kendimiz diziyor,
 * pinleri Web Mercator projeksiyonuyla üstüne koyuyoruz — ek paket yok, API
 * anahtarı yok, embed ile aynı görsel dil. Sürükle-kaydır + zoom destekli.
 */

export type MapViewProperty = {
  id: string;
  title: string;
  price: string;
  lat: number;
  lng: number;
};

const TILE = 256;
const MIN_ZOOM = 4;
const MAX_ZOOM = 17;
const MAP_HEIGHT = 520;

function lngToX(lng: number) {
  return (lng + 180) / 360;
}

function latToY(lat: number) {
  const r = (lat * Math.PI) / 180;
  return Math.min(1, Math.max(0, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2));
}

export function MapView({
  properties,
  missingCount,
}: {
  properties: MapViewProperty[];
  missingCount: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(6);
  // Varsayılan merkez: Türkiye (pinlere sığdırma genişlik ölçülünce yapılır)
  const [center, setCenter] = useState({ x: lngToX(35.2), y: latToY(39.0) });
  const [activeId, setActiveId] = useState<string | null>(null);

  const points = useMemo(
    () => properties.map((p) => ({ ...p, wx: lngToX(p.lng), wy: latToY(p.lat) })),
    [properties],
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

  // Pin kümesi değişince haritayı bir kez pinlere sığdır (kullanıcı gezinmesini ezme)
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

    let z = 15;
    while (z > MIN_ZOOM) {
      const scale = TILE * 2 ** z;
      if ((maxX - minX) * scale <= width - 90 && (maxY - minY) * scale <= MAP_HEIGHT - 140) break;
      z -= 1;
    }
    setZoom(z);
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

  if (points.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
        <MapPinOff className="mx-auto h-8 w-8 text-text-faint" />
        <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Haritada gösterilecek portföy yok</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
          Filtrelenen portföylerin hiçbirinde konum (enlem/boylam) işaretlenmemiş. Portföy düzenleme
          ekranındaki “Konum” alanından koordinat ekleyebilirsiniz.
        </p>
        {missingCount > 0 ? (
          <p className="mt-3 text-xs font-semibold text-amber-600">{missingCount} portföyün konumu işaretlenmemiş.</p>
        ) : null}
      </div>
    );
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

  const activePoint = points.find((p) => p.id === activeId) ?? null;

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
        aria-label="Portföy haritası"
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

        {points.map((p) => {
          const px = p.wx * scale - originX;
          const py = p.wy * scale - originY;
          if (px < -60 || px > width + 60 || py < -60 || py > MAP_HEIGHT + 60) return null;
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setActiveId(active ? null : p.id)}
              className="absolute z-10 -translate-x-1/2 -translate-y-full transition-transform hover:scale-110"
              style={{ left: px, top: py }}
              aria-label={`${p.title} — ${p.price}`}
              title={p.title}
            >
              <MapPin
                className={`h-8 w-8 drop-shadow-md ${active ? "text-mint-600" : "text-brand-600"}`}
                fill="currentColor"
                stroke="white"
                strokeWidth={1.5}
              />
            </button>
          );
        })}

        {activePoint ? (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-[230px] -translate-x-1/2 -translate-y-full rounded-[12px] border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
            style={{
              left: Math.min(Math.max(activePoint.wx * scale - originX, 120), Math.max(width - 120, 120)),
              top: Math.max(activePoint.wy * scale - originY - 40, 96),
            }}
          >
            <p className="line-clamp-2 text-sm font-bold text-ink-950">{activePoint.title}</p>
            <p className="mt-1 font-display text-base font-extrabold text-brand-600">{activePoint.price}</p>
            <Link
              href={`/app/portfoyler/${activePoint.id}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
            >
              Detay <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
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
        <span className="flex items-center gap-1.5 text-text-muted">
          <MapPin className="h-3.5 w-3.5 text-brand-600" />
          {points.length} portföy haritada
          {missingCount > 0 ? (
            <span className="ml-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-600">
              {missingCount} portföyün konumu işaretlenmemiş
            </span>
          ) : null}
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
