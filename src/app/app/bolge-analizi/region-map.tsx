"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, MapPinOff, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fitZoom, latToY, lngToX, visibleTiles } from "@/app/app/_ui/osm-tiles";

export type RegionMapPoint = {
  id: string;
  name: string;
  province: string;
  lat: number;
  lng: number;
  sqm: number | null;
  active: number;
  closed: number;
  trendHref: string;
  stockHref: string;
};

const MAP_HEIGHT = 440;
const MIN_ZOOM = 4;
const MAX_ZOOM = 15;
/** Sıralı palet: tek ton (marka mavisi), açıktan koyuya 5 kademe; ₺/m² yoksa nötr gri. */
const STEPS = [22, 38, 55, 72, 90];
const fill = (step: number | null) =>
  step == null ? "var(--line-strong)" : `color-mix(in oklab, var(--brand-600) ${STEPS[step]}%, var(--surface))`;

function money(n: number | null) {
  return n == null ? "—" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/**
 * PF-11 — Bölge analizi haritası: ilçe merkezinde baloncuk; RENK medyan ₺/m² (5 kademe, eşit sayılı dilimler),
 * BOYUT aktif stok. Dokununca ilçe kartı (trend + portföyler). OSM karoları, API anahtarı yok. Aynı veri sayfadaki
 * tabloda da var (renk tek başına bilgi taşımaz); dokunma hedefi ≥44 px.
 */
export function RegionMap({ points, missing }: { points: RegionMapPoint[]; missing: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(6);
  const [center, setCenter] = useState({ x: lngToX(35.2), y: latToY(39.0) });
  const [activeId, setActiveId] = useState<string | null>(null);

  const world = useMemo(() => points.map((p) => ({ ...p, wx: lngToX(p.lng), wy: latToY(p.lat) })), [points]);

  // ₺/m² kademeleri: eşit sayılı dilimler (uç değer bütün renkleri ezmesin).
  const { stepOf, bounds } = useMemo(() => {
    const vals = points.map((p) => p.sqm).filter((v): v is number => v != null).sort((a, b) => a - b);
    const cuts = vals.length >= 5 ? [1, 2, 3, 4].map((i) => vals[Math.floor((vals.length * i) / 5)]!) : [];
    const stepOf = (v: number | null) => {
      if (v == null) return null;
      if (cuts.length === 0) return 2;
      let s = 0;
      while (s < cuts.length && v >= cuts[s]!) s += 1;
      return s;
    };
    return { stepOf, bounds: vals.length >= 5 ? [vals[0]!, ...cuts, vals[vals.length - 1]!] : null };
  }, [points]);
  const maxActive = Math.max(1, ...points.map((p) => p.active));
  const radius = (active: number) => 11 + Math.sqrt(active / maxActive) * 19;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitted = useRef("");
  useEffect(() => {
    if (!width || world.length === 0) return;
    const key = world.map((p) => p.id).join(",");
    if (fitted.current === key) return;
    fitted.current = key;
    const xs = world.map((p) => p.wx);
    const ys = world.map((p) => p.wy);
    setZoom(fitZoom(xs, ys, width, MAP_HEIGHT, 120, MIN_ZOOM, 12));
    setCenter({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  }, [width, world]);

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
    const scale = 256 * 2 ** zoom;
    setCenter({ x: d.cx - dx / scale, y: Math.min(1, Math.max(0, d.cy - dy / scale)) });
  }
  function onPointerUp() {
    if (drag.current && !drag.current.moved) setActiveId(null);
    drag.current = null;
  }

  if (points.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
        <MapPinOff className="mx-auto h-8 w-8 text-text-faint" />
        <h3 className="mt-3 font-display text-base font-bold text-ink-950">Haritada gösterilecek ilçe yok</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-text-muted">
          Listelenen ilçelerin merkez koordinatı coğrafya kaydında bulunmuyor. Tablo görünümü tüm ilçeleri gösterir.
        </p>
      </div>
    );
  }

  const { tiles, originX, originY, scale } = visibleTiles(center, zoom, width, MAP_HEIGHT);
  const active = world.find((p) => p.id === activeId) ?? null;
  // Büyük baloncuk altta kalsın, küçükler tıklanabilir olsun.
  const ordered = [...world].sort((a, b) => b.active - a.active);

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <div
        ref={boxRef}
        className="relative w-full cursor-grab touch-none select-none overflow-hidden bg-canvas active:cursor-grabbing"
        style={{ height: MAP_HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="İlçe fiyat ve stok haritası"
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element -- OSM karoları; next/image remote domain konfigürasyonu gerektirir
          <img
            key={t.key}
            src={t.src}
            alt=""
            width={256}
            height={256}
            draggable={false}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            className="pointer-events-none absolute max-w-none opacity-80 saturate-50"
            style={{ left: t.left, top: t.top }}
          />
        ))}

        {ordered.map((p) => {
          const px = p.wx * scale - originX;
          const py = p.wy * scale - originY;
          const r = radius(p.active);
          if (px < -r || px > width + r || py < -r || py > MAP_HEIGHT + r) return null;
          const isActive = p.id === activeId;
          const step = stepOf(p.sqm);
          return (
            <Button
              key={p.id}
              variant="ghost"
              size="icon"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setActiveId(isActive ? null : p.id)}
              aria-label={`${p.name}: medyan ${money(p.sqm)}/m², ${p.active} aktif portföy`}
              aria-pressed={isActive}
              className="absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full p-0 hover:bg-transparent"
              style={{ left: px, top: py, width: Math.max(44, r * 2), height: Math.max(44, r * 2) }}
            >
              <span
                aria-hidden
                className={`block rounded-full transition-transform ${isActive ? "scale-110" : ""}`}
                style={{
                  width: r * 2,
                  height: r * 2,
                  background: fill(step),
                  boxShadow: isActive ? "0 0 0 2px var(--surface), 0 0 0 4px var(--ink-950)" : "0 0 0 2px var(--surface)",
                  opacity: 0.92,
                }}
              />
            </Button>
          );
        })}

        {active ? (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-[240px] -translate-x-1/2 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
            style={{
              left: Math.min(Math.max(active.wx * scale - originX, 125), Math.max(width - 125, 125)),
              top: Math.min(Math.max(active.wy * scale - originY + radius(active.active) + 8, 8), MAP_HEIGHT - 150),
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink-950">{active.name}</p>
                <p className="text-xs text-text-muted">{active.province}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setActiveId(null)} aria-label="Kapat" className="shrink-0">
                <X />
              </Button>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-text-faint">₺/m²</dt>
                <dd className="numeric font-bold text-ink-950">{money(active.sqm)}</dd>
              </div>
              <div>
                <dt className="text-text-faint">Aktif</dt>
                <dd className="numeric font-bold text-ink-950">{active.active}</dd>
              </div>
              <div>
                <dt className="text-text-faint">Kapanan</dt>
                <dd className="numeric font-bold text-ink-950">{active.closed}</dd>
              </div>
            </dl>
            <div className="mt-2 flex gap-3 text-xs font-semibold">
              <Link href={active.trendHref} className="focus-ring inline-flex min-h-8 items-center gap-1 text-brand-600 hover:underline touch:min-h-11">
                Trend <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link href={active.stockHref} className="focus-ring inline-flex min-h-8 items-center gap-1 text-brand-600 hover:underline touch:min-h-11">
                Portföyler <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ) : null}

        <div className="absolute right-3 top-3 z-20 flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <Button
            variant="ghost"
            size="icon"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
            className="rounded-none text-ink-950"
            aria-label="Yakınlaştır"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
            className="rounded-none border-t border-line text-ink-950"
            aria-label="Uzaklaştır"
          >
            <Minus />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2.5 text-xs text-text-muted">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1.5" aria-label="Renk: medyan metrekare fiyatı, açık düşük, koyu yüksek">
            <span className="font-semibold">Medyan ₺/m²</span>
            {STEPS.map((_, i) => (
              <span key={i} aria-hidden className="h-3 w-5 first:rounded-l-full last:rounded-r-full" style={{ background: fill(i) }} />
            ))}
            {bounds ? (
              <span className="numeric">
                {money(bounds[0]!)} – {money(bounds[bounds.length - 1]!)}
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-line-strong" />
            <span aria-hidden className="inline-block h-4 w-4 rounded-full border border-line-strong" />
            Boyut: aktif stok
          </span>
          {missing > 0 ? <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-700">{missing} ilçenin konumu yok</span> : null}
        </div>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-text-faint hover:underline">
          © OpenStreetMap katkıda bulunanlar
        </a>
      </div>
    </div>
  );
}
