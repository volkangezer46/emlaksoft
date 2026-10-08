"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clampRange,
  dragEdge,
  fullRange,
  indexAtFraction,
  isFullRange,
  moveWindow,
  presetsFor,
  rangeForPreset,
  summarizeRange,
  type Granularity,
  type Range,
  type RangeSummaryMode,
} from "@/components/ui/chart-range-math";

/**
 * Grafik zaman aralığı katmanı (Recharts İÇERMEZ; AreaTrendChart, AreaTrend ve InteractiveChart ortak kullanır).
 *
 * - `useChartRange(n)`: aralık durumu. Veri uzunluğu değişince (kapsam/filtre değişimi) otomatik tam aralığa döner.
 * - `ChartRangePanel`: üstte canlı özet (toplam/son değer + değişim %) ve hazır aralık hapları (7G/30G/3A/6A/1Y/Tümü —
 *   yalnız veri yettiği kadar), altta sürüklenebilir mini harita (iki kenar + pencere; çift tık = sıfırla).
 * - Sürükleme rAF ile birleştirilir (kare başına en çok 1 durum güncellemesi → 60 fps); klavye: kenarlarda ←/→
 *   (Shift = 3 nokta), pencerede ←/→ kaydırır, Esc/Home sıfırlar.
 * Veri sunucudan geniş aralıkta gelir; süzme istemcidedir (sahte veri yok, taban yoksa değişim gösterilmez).
 */

export function useChartRange(n: number) {
  const [state, setState] = useState<{ n: number; range: Range } | null>(null);
  const range = useMemo<Range>(() => (state && state.n === n ? clampRange(state.range, n) : fullRange(n)), [state, n]);
  const setRange = useCallback((r: Range) => setState({ n, range: clampRange(r, n) }), [n]);
  const reset = useCallback(() => setState(null), []);
  return { range, setRange, reset, full: isFullRange(range, n), touched: state !== null && state.n === n };
}

const posOf = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
const pctFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

function MiniMap({
  values,
  labels,
  range,
  onChange,
  onReset,
  color,
}: {
  values: ReadonlyArray<number | null | undefined>;
  labels: readonly string[];
  range: Range;
  onChange: (r: Range) => void;
  onReset: () => void;
  color: string;
}) {
  const n = values.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "start" | "end" | "move"; grab: number } | null>(null);
  const raf = useRef(0);
  const pending = useRef<number | null>(null);
  const latest = useRef({ range, n, onChange });
  useEffect(() => {
    latest.current = { range, n, onChange };
  });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const indexAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const f = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return indexAtFraction(Math.max(0, Math.min(1, f)), latest.current.n);
  };

  const flush = () => {
    raf.current = 0;
    const d = drag.current;
    const x = pending.current;
    if (!d || x === null) return;
    const { range: r, n: count, onChange: emit } = latest.current;
    const idx = indexAt(x);
    if (d.mode === "move") emit(moveWindow(r, idx - d.grab, count));
    else emit(dragEdge(r, d.mode, idx, count));
  };

  const begin = (mode: "start" | "end" | "move", e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const idx = indexAt(e.clientX);
    drag.current = { mode, grab: mode === "move" ? idx - range[0] : 0 };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    pending.current = e.clientX;
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (pending.current !== null) flush();
    pending.current = null;
    drag.current = null;
  };

  // İzin verilen en yakın nokta: pencere dışına tıklayınca pencere oraya ortalanır ve sürüklemeye geçer.
  const trackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const span = range[1] - range[0];
    const idx = indexAt(e.clientX);
    onChange(moveWindow(range, idx - Math.round(span / 2), n));
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: "move", grab: Math.round(span / 2) };
  };

  const keyEdge = (edge: "start" | "end") => (e: ReactKeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 3 : 1;
    const cur = edge === "start" ? range[0] : range[1];
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      onReset();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    onChange(dragEdge(range, edge, next, n));
  };
  const keyWindow = (e: ReactKeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 3 : 1;
    if (e.key === "ArrowLeft") onChange(moveWindow(range, range[0] - step, n));
    else if (e.key === "ArrowRight") onChange(moveWindow(range, range[0] + step, n));
    else if (e.key === "Escape" || e.key === "Home") onReset();
    else return;
    e.preventDefault();
  };

  const pos = (i: number) => posOf(i, n);
  const path = useMemo(() => {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (nums.length < 2) return null;
    const max = Math.max(...nums);
    const min = Math.min(...nums, 0);
    const span = max - min || 1;
    let last = nums[0]!;
    const pts = values.map((v, i) => {
      if (typeof v === "number" && Number.isFinite(v)) last = v;
      return { x: posOf(i, n), y: 94 - ((last - min) / span) * 86 };
    });
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    return { line, area: `${line} L100,100 L0,100 Z` };
  }, [values, n]);

  const left = pos(range[0]);
  const right = pos(range[1]);
  const dim = "color-mix(in srgb, var(--surface) 68%, transparent)";
  const grip = "absolute top-0 z-10 flex h-full w-4 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center focus-visible:outline-none";

  return (
    <div className="mx-2">
      <div
        ref={trackRef}
        className="relative h-10 touch-none select-none rounded-[var(--radius-control)] border border-hairline bg-surface-raised"
        onPointerDown={trackDown}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={onReset}
        title="Aralığı sürükleyin · çift tık: sıfırla"
      >
        <div className="absolute inset-0 overflow-hidden rounded-[var(--radius-control)]" aria-hidden="true">
          {path ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              <path d={path.area} fill={color} opacity={0.16} />
              <path d={path.line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          ) : null}
          <div className="absolute inset-y-0 left-0" style={{ width: `${left}%`, background: dim }} />
          <div className="absolute inset-y-0 right-0" style={{ width: `${100 - right}%`, background: dim }} />
        </div>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Seçili aralık: ${labels[range[0]] ?? ""} – ${labels[range[1]] ?? ""}. Kaydırmak için sol/sağ ok, sıfırlamak için Esc.`}
          className="absolute inset-y-0 cursor-grab touch-none border-y-2 outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%`, borderColor: color }}
          onPointerDown={(e) => begin("move", e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={keyWindow}
        />
        {(["start", "end"] as const).map((edge) => {
          const i = edge === "start" ? range[0] : range[1];
          return (
            <div
              key={edge}
              role="slider"
              tabIndex={0}
              aria-label={edge === "start" ? "Aralık başlangıcı" : "Aralık bitişi"}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={n - 1}
              aria-valuenow={i}
              aria-valuetext={labels[i]}
              className={grip}
              style={{ left: `${pos(i)}%` }}
              onPointerDown={(e) => begin(edge, e)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={keyEdge(edge)}
            >
              <span
                className="block h-6 w-2.5 rounded-full border-2 bg-surface-raised shadow-[var(--elev-2)] transition-transform hover:scale-110"
                style={{ borderColor: color }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartRangePanel({
  labels,
  values,
  allValues,
  range,
  onRangeChange,
  onReset,
  summaryMode = "last",
  formatValue,
  color,
  granularity = "month",
  anchor,
  summaryLabel,
  className,
  children,
}: {
  labels: readonly string[];
  /** Mini harita çizgisi (birincil seri; null = boşluk). */
  values: ReadonlyArray<number | null | undefined>;
  /** Özet için seri (verilmezse `values`). */
  allValues?: ReadonlyArray<number | null | undefined>;
  range: Range;
  onRangeChange: (r: Range) => void;
  onReset: () => void;
  summaryMode?: RangeSummaryMode;
  formatValue: (n: number) => string;
  color: string;
  granularity?: Granularity;
  /** Son gerçek nokta indeksi (tahmin kuyruğu varsa). */
  anchor?: number;
  /** Özet etiketi (ör. "Komisyon tahakkuku"). */
  summaryLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  const n = values.length;
  const presets = useMemo(() => presetsFor((anchor ?? n - 1) + 1, granularity), [anchor, n, granularity]);
  const summary = useMemo(() => summarizeRange(allValues ?? values, range, summaryMode), [allValues, values, range, summaryMode]);
  const full = isFullRange(range, n);
  const activeKey = useMemo(() => {
    for (const p of presets) {
      const r = rangeForPreset(n, p.count, anchor);
      if (r[0] === range[0] && r[1] === range[1]) return p.key;
    }
    return null;
  }, [presets, n, anchor, range]);

  const caption =
    summaryMode === "total" ? "aralık toplamı" : summaryMode === "last" ? "aralık sonu" : "";
  const basis = summary.change?.basis === "previous" ? "önceki aynı süreye göre" : "aralık başına göre";
  const up = (summary.change?.pct ?? 0) >= 0;
  const startLabel = labels[range[0]] ?? "";
  const endLabel = labels[range[1]] ?? "";

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-text-muted" aria-live="off">
            {summaryLabel ? `${summaryLabel} · ` : ""}
            {startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`}
            {caption ? ` · ${caption}` : ""}
          </p>
          {summary.main !== null ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="numeric font-display text-lg font-extrabold tracking-[-0.01em] text-[color:var(--viz-tooltip-text)]">
                {formatValue(summary.main)}
              </span>
              {summary.change ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
                  style={{
                    color: up ? "var(--viz-pos)" : "var(--viz-neg)",
                    background: `color-mix(in srgb, ${up ? "var(--viz-pos)" : "var(--viz-neg)"} 12%, transparent)`,
                  }}
                  title={basis}
                >
                  {up ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                  {up ? "+" : "−"}%{pctFmt.format(Math.abs(summary.change.pct))}
                  <span className="sr-only"> {basis}</span>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Hazır zaman aralıkları">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={activeKey === p.key}
              onClick={() => (p.count === null ? onReset() : onRangeChange(rangeForPreset(n, p.count, anchor)))}
              className={cn(
                "focus-ring min-h-7 rounded-full px-2.5 text-xs font-semibold transition-colors",
                activeKey === p.key ? "bg-surface-selected text-accent-text" : "text-text-muted hover:bg-surface-hover hover:text-text",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
      {n >= 4 ? (
        <MiniMap values={values} labels={labels} range={range} onChange={onRangeChange} onReset={onReset} color={color} />
      ) : null}
      {!full ? (
        <p className="sr-only" role="status">
          Gösterilen aralık: {startLabel} – {endLabel}
        </p>
      ) : null}
    </div>
  );
}
