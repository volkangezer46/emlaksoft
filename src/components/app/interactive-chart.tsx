"use client";

import { useEffect, useMemo, useRef, useState, useId } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

/**
 * InteractiveChart — el yapımı SVG çizgi/alan grafiği, gerçek etkileşimle.
 *
 * Neden Recharts değil: hero kartlarındaki mevcut el yapımı trendlerin görsel
 * dilini (chart-draw çizim animasyonu, gradyan dolgu, uç nokta halkası) birebir
 * korurken üstüne crosshair + takip eden tooltip ekler. Piksel koordinatlarıyla
 * çizer (ResizeObserver), böylece çizgi kalınlığı ve noktalar hiç deforme olmaz.
 *
 * - Hover/dokunmatik: dikey crosshair + en yakın nokta büyür + tooltip balonu.
 * - Çift seri desteği (gelir vs gider): iki çizgi, tooltip'te ikisi + opsiyonel fark satırı.
 * - Soldan sağa çizilme animasyonu globals.css'teki `chart-draw` deseniyle;
 *   prefers-reduced-motion'da global kural animasyonu kapatır.
 * - Props serileştirilebilir — Server Component sayfalardan doğrudan çağrılır.
 */

export type InteractiveChartPoint = {
  label: string;
  value: number;
  /** İkinci seri (ör. gider). Verilirse çift çizgi çizilir. */
  value2?: number;
};

type Props = {
  data: InteractiveChartPoint[];
  /** 1. seri rengi — CSS değişkeni önerilir, ör. "var(--brand-600)". */
  color?: string;
  color2?: string;
  /** Tooltip'te seri adı (ör. "Gelir"). */
  name?: string;
  name2?: string;
  format?: "money" | "number";
  /** Çizim alanı yüksekliği (px) — etiket satırı bunun altına akar. */
  height?: number;
  showLabels?: boolean;
  /** Etiket seyreltme: n → sondan geriye her n. etiket gösterilir (dar kartlar için). */
  labelEvery?: number;
  /** Çift seride tooltip'e fark satırı ekler (ör. "Net"). */
  diffLabel?: string;
  /** Çift seride komponent içi lejant (sayfada zaten varsa kapatın). */
  showLegend?: boolean;
  className?: string;
};

const nfNumber = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

function fmt(v: number, format: "money" | "number") {
  return format === "money" ? `${nfNumber.format(v)} ₺` : nfNumber.format(v);
}

const PAD_TOP = 10;
const PAD_BOTTOM = 4;
const PAD_X = 4;

export function InteractiveChart({
  data,
  color = "var(--brand-600)",
  color2 = "var(--danger-500)",
  name = "Değer",
  name2 = "2. seri",
  format = "number",
  height = 160,
  showLabels = true,
  labelEvery = 1,
  diffLabel,
  showLegend = true,
  className,
}: Props) {
  const reactId = useId();
  const uid = `ichart-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  const dual = data.some((d) => typeof d.value2 === "number");
  const n = data.length;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (width <= 0 || n === 0) return null;
    const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)));
    const plotW = width - PAD_X * 2;
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    const x = (i: number) => (n === 1 ? width / 2 : PAD_X + (i / (n - 1)) * plotW);
    const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;
    const pts1 = data.map((d, i) => ({ x: x(i), y: y(d.value) }));
    const pts2 = dual ? data.map((d, i) => ({ x: x(i), y: y(d.value2 ?? 0) })) : null;
    const lineOf = (pts: { x: number; y: number }[]) =>
      pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaOf = (pts: { x: number; y: number }[]) =>
      `${pts[0].x.toFixed(1)},${height - PAD_BOTTOM} ${lineOf(pts)} ${pts[pts.length - 1].x.toFixed(1)},${height - PAD_BOTTOM}`;
    const lenOf = (pts: { x: number; y: number }[]) => {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return Math.ceil(len) + 8;
    };
    return { x, y, pts1, pts2, lineOf, areaOf, lenOf, baseline: height - PAD_BOTTOM };
  }, [width, height, n, data, dual]);

  const nearestIndex = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || n === 0) return null;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    if (n === 1) return 0;
    const step = (width - PAD_X * 2) / (n - 1);
    return Math.min(n - 1, Math.max(0, Math.round((px - PAD_X) / step)));
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const idx = nearestIndex(e.clientX);
    if (idx !== null) setHover(idx);
  };

  // Boş durum — zarif yer tutucu
  if (n === 0) {
    return (
      <div className={className}>
        <div className="grid place-items-center rounded-[12px] bg-canvas/60 text-xs text-text-faint" style={{ height }}>
          Henüz veri yok
        </div>
      </div>
    );
  }

  const active = hover !== null ? data[hover] : null;
  const seriesRows = active
    ? [
        { label: name, value: active.value, color },
        ...(dual ? [{ label: name2, value: active.value2 ?? 0, color: color2 }] : []),
      ]
    : [];

  // Tooltip konumu — noktaların üstünde, kenarlarda taşmayacak şekilde kıstırılır
  let tipLeft = 0;
  let tipTop = 0;
  if (geo && hover !== null) {
    tipLeft = Math.min(Math.max(geo.x(hover), 78), Math.max(78, width - 78));
    const ys = [geo.pts1[hover].y, ...(geo.pts2 ? [geo.pts2[hover].y] : [])];
    tipTop = Math.max(4, Math.min(...ys) - 10);
  }

  const labelVisible = (i: number) => (n - 1 - i) % Math.max(1, labelEvery) === 0;

  return (
    <div className={className}>
      <div
        ref={wrapRef}
        className="relative"
        style={{ height, touchAction: "pan-y" }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        {geo ? (
          <>
            <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden="true">
              <defs>
                <linearGradient id={`${uid}-g1`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
                {geo.pts2 ? (
                  <linearGradient id={`${uid}-g2`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color2} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={color2} stopOpacity="0" />
                  </linearGradient>
                ) : null}
              </defs>

              {/* Grid — %5 opaklık, yataylar */}
              {[0.25, 0.5, 0.75, 1].map((f) => {
                const gy = PAD_TOP + (1 - f) * (height - PAD_TOP - PAD_BOTTOM);
                return (
                  <line key={f} x1={PAD_X} x2={width - PAD_X} y1={gy} y2={gy} stroke="var(--ink-950)" strokeOpacity="0.05" strokeWidth="1" />
                );
              })}

              {n > 1 ? (
                <>
                  <polygon points={geo.areaOf(geo.pts1)} fill={`url(#${uid}-g1)`} />
                  {geo.pts2 ? <polygon points={geo.areaOf(geo.pts2)} fill={`url(#${uid}-g2)`} /> : null}
                  <polyline
                    className="chart-draw"
                    style={{ "--len": geo.lenOf(geo.pts1) } as CSSProperties}
                    points={geo.lineOf(geo.pts1)}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {geo.pts2 ? (
                    <polyline
                      className="chart-draw"
                      style={{ "--len": geo.lenOf(geo.pts2), animationDelay: "120ms" } as CSSProperties}
                      points={geo.lineOf(geo.pts2)}
                      fill="none"
                      stroke={color2}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </>
              ) : null}

              {/* Uç nokta — canlı halka (yalnızca hover yokken vurgulu) */}
              {hover === null ? (
                <>
                  <circle cx={geo.pts1[n - 1].x} cy={geo.pts1[n - 1].y} r="5" fill={color} opacity="0.3" className="glow-halo" />
                  <circle cx={geo.pts1[n - 1].x} cy={geo.pts1[n - 1].y} r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
                  {geo.pts2 ? (
                    <circle cx={geo.pts2[n - 1].x} cy={geo.pts2[n - 1].y} r="3" fill={color2} stroke="var(--surface)" strokeWidth="1.5" />
                  ) : null}
                </>
              ) : null}

              {/* Crosshair + büyüyen aktif noktalar */}
              {hover !== null ? (
                <>
                  <line
                    x1={geo.x(hover)}
                    x2={geo.x(hover)}
                    y1={PAD_TOP - 4}
                    y2={geo.baseline}
                    stroke="var(--ink-950)"
                    strokeOpacity="0.18"
                    strokeWidth="1"
                    style={{ transition: "x1 120ms ease-out, x2 120ms ease-out" }}
                  />
                  <circle
                    cx={geo.pts1[hover].x}
                    cy={geo.pts1[hover].y}
                    r="5.5"
                    fill={color}
                    stroke="var(--surface)"
                    strokeWidth="2"
                    style={{ transition: "cx 120ms ease-out, cy 120ms ease-out" }}
                  />
                  {geo.pts2 ? (
                    <circle
                      cx={geo.pts2[hover].x}
                      cy={geo.pts2[hover].y}
                      r="5.5"
                      fill={color2}
                      stroke="var(--surface)"
                      strokeWidth="2"
                      style={{ transition: "cx 120ms ease-out, cy 120ms ease-out" }}
                    />
                  ) : null}
                </>
              ) : null}
            </svg>

            {/* Tooltip balonu — surface-card dili, takip eder */}
            {hover !== null && active ? (
              <div
                className="pointer-events-none absolute z-10 min-w-[140px] -translate-x-1/2 -translate-y-full rounded-[11px] border border-hairline bg-surface/95 px-3 py-2 shadow-[var(--inner-top),var(--elev-4)] backdrop-blur-sm"
                style={{ left: tipLeft, top: tipTop, transition: "left 120ms ease-out, top 120ms ease-out" }}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-faint">{active.label}</p>
                {seriesRows.map((row) => (
                  <p key={row.label} className="flex items-center gap-2 text-xs text-ink-950">
                    <span className="h-2 w-2 shrink-0 rounded-full ring-2 ring-inset ring-white/40" style={{ background: row.color }} />
                    <span className="text-text-muted">{row.label}</span>
                    <span className="numeric ml-auto pl-3 font-bold tabular-nums">{fmt(row.value, format)}</span>
                  </p>
                ))}
                {dual && diffLabel ? (
                  <p className="mt-1 flex items-center gap-2 border-t border-hairline pt-1 text-xs">
                    <span className="text-text-muted">{diffLabel}</span>
                    <span
                      className={`numeric ml-auto pl-3 font-bold tabular-nums ${
                        active.value - (active.value2 ?? 0) >= 0 ? "text-mint-600" : "text-danger-500"
                      }`}
                    >
                      {active.value - (active.value2 ?? 0) >= 0 ? "+" : "−"}
                      {fmt(Math.abs(active.value - (active.value2 ?? 0)), format)}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* X ekseni etiketleri */}
      {showLabels && geo ? (
        <div className="relative mt-1.5 h-4 select-none">
          {data.map((d, i) => {
            if (!labelVisible(i)) return null;
            const px = geo.x(i);
            const edgeShift = i === 0 ? "0%" : i === n - 1 ? "-100%" : "-50%";
            return (
              <span
                key={`${d.label}-${i}`}
                className={`absolute top-0 whitespace-nowrap text-[10px] font-semibold transition-colors ${
                  hover === i ? "text-ink-950" : "text-text-muted"
                }`}
                style={{ left: px, transform: `translateX(${edgeShift})` }}
              >
                {d.label}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Lejant — çift seri */}
      {dual && showLegend ? (
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} /> {name}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color2 }} /> {name2}
          </span>
        </div>
      ) : null}
    </div>
  );
}
