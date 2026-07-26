"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Minus, Plus } from "lucide-react";
import type { TalepArzTone } from "@/lib/talep-arz";

/**
 * Talep-arz dengesi haritası — portföy haritasıyla (portfoyler/map-view.tsx)
 * birebir aynı teknoloji: OSM raster karoları + Web Mercator projeksiyonu,
 * ek paket ve API anahtarı yok. Fark: pin yerine İL merkezlerine daire
 * marker basılır — boyut talep sayısına, renk arz/talep dengesine göre
 * (yeşil-amber-kırmızı). İlçe merkezlerinin koordinatı geo_districts'te
 * dolu olmadığı için ilçe seviyesi ayrı bar grafikte gösterilir.
 */

export type TalepArzMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  demand: number;
  supply: number;
  tone: TalepArzTone;
  /** Tıklanınca gidilecek hedef — raporun kendisi, ?il= filtresiyle. */
  href: string;
};

const TILE = 256;
const MIN_ZOOM = 4;
const MAX_ZOOM = 12;
const MAP_HEIGHT = 460;

const TONE_CLS: Record<TalepArzTone, { fill: string; ring: string; text: string; label: string }> = {
  mint: { fill: "bg-mint-500/60", ring: "ring-mint-600", text: "text-mint-600", label: "Arz talebi karşılıyor" },
  amber: { fill: "bg-amber-400/65", ring: "ring-amber-500", text: "text-amber-600", label: "Kısmi karşılama" },
  red: { fill: "bg-danger-500/60", ring: "ring-danger-500", text: "text-danger-500", label: "Talep aç" },
};

function lngToX(lng: number) {
  return (lng + 180) / 360;
}

function latToY(lat: number) {
  const r = (lat * Math.PI) / 180;
  return Math.min(1, Math.max(0, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2));
}

/** Daire çapı (px) — talep sayısıyla karekök ölçek; 0 talep de görünür kalır. */
function markerSize(demand: number) {
  return Math.min(64, 18 + Math.sqrt(demand) * 10);
}

export function TalepArzMap({ markers }: { markers: TalepArzMarker[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(5);
  // Varsayılan merkez: Türkiye (marker kümesine sığdırma genişlik ölçülünce)
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

  // Marker kümesi değişince haritayı bir kez sığdır (kullanıcı gezinmesini ezme)
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
      if ((maxX - minX) * scale <= width - 120 && (maxY - minY) * scale <= MAP_HEIGHT - 140) break;
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
        aria-label="Talep-arz dengesi haritası"
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
          if (px < -80 || px > width + 80 || py < -80 || py > MAP_HEIGHT + 80) return null;
          const size = markerSize(p.demand);
          const active = p.id === activeId;
          const tone = TONE_CLS[p.tone];
          return (
            <button
              key={p.id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setActiveId(active ? null : p.id)}
              className={`absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full ring-2 backdrop-blur-[1px] transition-transform hover:scale-110 ${tone.fill} ${tone.ring} ${active ? "scale-110" : ""}`}
              style={{ left: px, top: py, width: size, height: size }}
              aria-label={`${p.name} — ${p.demand} talep, ${p.supply} portföy`}
              title={`${p.name}: ${p.demand} talep · ${p.supply} portföy`}
            >
              <span className="text-[11px] font-extrabold text-white drop-shadow-sm">{p.demand}</span>
            </button>
          );
        })}

        {activePoint ? (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-[230px] -translate-x-1/2 -translate-y-full rounded-[12px] border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
            style={{
              left: Math.min(Math.max(activePoint.wx * scale - originX, 120), Math.max(width - 120, 120)),
              top: Math.max(activePoint.wy * scale - originY - markerSize(activePoint.demand) / 2 - 8, 96),
            }}
          >
            <p className="text-sm font-bold text-ink-950">{activePoint.name}</p>
            <p className="mt-1 text-xs tabular-nums text-text-muted">
              {activePoint.demand} açık talep · {activePoint.supply} yayında portföy
            </p>
            <p className={`mt-0.5 text-[11px] font-semibold ${TONE_CLS[activePoint.tone].text}`}>
              {TONE_CLS[activePoint.tone].label}
            </p>
            <Link
              href={activePoint.href}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
            >
              İlçe dökümünü gör <ArrowUpRight className="h-3.5 w-3.5" />
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
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-mint-500" /> Arz talebi karşılıyor
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Kısmi karşılama
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Talep aç
          </span>
          <span className="text-text-faint">Daire boyutu = talep sayısı</span>
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
