"use client";

import { useId, useState, type CSSProperties } from "react";
import { monotonePath, niceRange } from "@/components/ui/viz/curve";
import Link from "@/components/ui/smart-link";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { cn } from "@/lib/utils";

/**
 * Nakit akışı grafiği (30/90 gün; `next/dynamic` ile iner). Tek seri: gün sonu bakiye (TL'ye çevrilmiş).
 * Gerçekleşen kısım düz çizgi, tahmin kesikli çizgi ve "tahmin" etiketli; en düşük bakiye eşiği kesikli uyarı çizgisi.
 * Her gün bir bağlantıdır (gerçekleşen → o günün hareketleri, tahmin → o gün vadesi gelen kalemler); fare/dokunma ile
 * artı imleci ve ipucu çıkar. Tek seri olduğu için lejant kutusu yok; başlık seriyi adlandırır, tablo görünümü altta.
 */

export type ForecastChartPoint = { day: string; balance: number; inflow: number; outflow: number; actual: boolean; href: string };

const W = 720;
const H = 220;
const PAD_TOP = 16;
const PAD_BOTTOM = 4;
const tlAxis = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

function shortDay(day: string) {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

export function ForecastChart({ points, minBalance }: { points: readonly ForecastChartPoint[]; minBalance: number | null }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  const values = points.map((p) => p.balance);
  // Düzey serisi (bakiye): eksen sıfırdan başlamaz, "güzel" aralık seçilir (düz görünen çizgi yerine gerçek değişim okunur).
  const ticks = niceRange(Math.min(...values, minBalance ?? Infinity), Math.max(...values, minBalance ?? -Infinity), 4);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD_TOP + (1 - (v - lo) / span) * (H - PAD_TOP - PAD_BOTTOM);
  const pts = (from: number, to: number) => points.slice(from, to + 1).map((p, k) => ({ x: x(from + k), y: y(p.balance) }));
  const path = (from: number, to: number) => monotonePath(pts(from, to));
  const area = (from: number, to: number) => `${path(from, to)} L${x(to).toFixed(1)},${H} L${x(from).toFixed(1)},${H} Z`;

  const lastActual = points.reduce((acc, p, i) => (p.actual ? i : acc), -1);
  const forecastFrom = Math.max(lastActual, 0);
  let lowIdx = forecastFrom;
  for (let i = forecastFrom; i < points.length; i++) if (points[i]!.balance < points[lowIdx]!.balance) lowIdx = i;
  const low = points[lowIdx]!;
  const breach = minBalance != null && low.balance < minBalance;
  const h = hover != null ? points[hover] : null;
  const n = points.length - 1;
  const xTicks = [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((n * 3) / 4), n])];
  const pctX = (i: number) => `${(x(i) / W) * 100}%`;
  const gutter = `${Math.max(...ticks.map((t) => `₺${tlAxis.format(t)}`.length)) * 0.6 + 0.3}em`;

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[var(--fc-g)_minmax(0,1fr)] gap-x-2.5 text-xs" style={{ "--fc-g": gutter } as CSSProperties}>
        {/* Y ekseni: tam TL (kısaltma yok), ızgarayla aynı konumlar */}
        <div className="relative h-[220px]" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 whitespace-nowrap leading-none tabular-nums text-text-muted" style={{ top: `${(y(t) / H) * 100}%` }}>
              ₺{tlAxis.format(t)}
            </span>
          ))}
        </div>
        <div className="relative mr-2" onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[220px] w-full overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id={`fc-a-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--brand-600)" stopOpacity="0.24" />
                <stop offset="1" stopColor="var(--brand-600)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`fc-f-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--brand-600)" stopOpacity="0.1" />
                <stop offset="1" stopColor="var(--brand-600)" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`fc-c-${uid}`}>
                <rect x="-4" y="-20" width={W + 8} height={H + 40} className="viz-reveal" />
              </clipPath>
            </defs>
            {/* Izgara (silik), sıfır ve eşik çizgileri */}
            {ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
            ))}
            {lo < 0 ? <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-strong, currentColor)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.8} /> : null}
            {minBalance != null ? (
              <line x1={0} x2={W} y1={y(minBalance)} y2={y(minBalance)} stroke="var(--color-amber-500)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            ) : null}
            {lastActual > 0 && lastActual < n ? (
              <line x1={x(lastActual)} x2={x(lastActual)} y1={PAD_TOP / 2} y2={H} stroke="var(--text-faint, currentColor)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            ) : null}
            <g clipPath={`url(#fc-c-${uid})`}>
              {lastActual > 0 ? <path d={area(0, lastActual)} fill={`url(#fc-a-${uid})`} /> : null}
              {forecastFrom < n ? <path d={area(forecastFrom, n)} fill={`url(#fc-f-${uid})`} /> : null}
              {lastActual > 0 ? (
                <path d={path(0, lastActual)} fill="none" stroke="var(--brand-600)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              ) : null}
              {forecastFrom < n ? (
                <path d={path(forecastFrom, n)} fill="none" stroke="var(--brand-600)" strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              ) : null}
            </g>
            {h && hover != null ? <line x1={x(hover)} x2={x(hover)} y1={PAD_TOP / 2} y2={H} stroke="var(--text-faint, currentColor)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {/* İşaretçiler HTML'de (SVG oranı bozulsa da yuvarlak kalır) */}
          <span
            className={cn("pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-[var(--elev-1)]", breach ? "bg-danger-500" : "bg-brand-600")}
            style={{ left: pctX(lowIdx), top: `${(y(low.balance) / H) * 220}px` }}
          />
          {lastActual >= 0 ? (
            <span
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-600 bg-surface"
              style={{ left: pctX(lastActual), top: `${(y(points[lastActual]!.balance) / H) * 220}px` }}
            />
          ) : null}
          {h && hover != null ? (
            <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand-600 shadow-[var(--elev-1)]" style={{ left: pctX(hover), top: `${(y(h.balance) / H) * 220}px` }} />
          ) : null}
          {/* Bugün ayracı: tahmin bölgesinin başı */}
          {lastActual >= 0 && lastActual < n ? (
            <span className="pointer-events-none absolute -top-1 rounded-full bg-surface px-1.5 text-xs font-semibold text-text-muted" style={{ left: `calc(${pctX(lastActual)} + 6px)` }}>
              Bugün · tahmin →
            </span>
          ) : null}
          {/* Gün bağlantıları: her gün tıklanabilir hedef (sıfır çıkmaz metrik) */}
          <div className="absolute inset-x-0 top-0 flex" style={{ height: H }}>
            {points.map((p, i) => (
              <Link
                key={p.day}
                href={p.href}
                tabIndex={-1}
                aria-label={`${shortDay(p.day)} ${p.actual ? "gerçekleşen" : "tahmin"} bakiye ${formatAccountMoney(p.balance, "TRY")}`}
                className="h-full flex-1"
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
              />
            ))}
          </div>
          {h && hover != null ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-elev)]"
              style={hover > points.length / 2 ? { right: `${100 - (x(hover) / W) * 100 + 1}%` } : { left: `${(x(hover) / W) * 100 + 1}%` }}
            >
              <p className="font-semibold text-text">
                {shortDay(h.day)} · {h.actual ? "gerçekleşen" : "tahmin"}
              </p>
              <p className="numeric mt-0.5 font-display text-sm font-bold text-text">{formatAccountMoney(h.balance, "TRY")}</p>
              <p className="numeric text-text-muted">
                Giriş {formatAccountMoney(h.inflow, "TRY")} · Çıkış {formatAccountMoney(h.outflow, "TRY")}
              </p>
            </div>
          ) : null}
          {/* X ekseni: etiket noktanın tam altında ortalanır (iki yana yaslı dağıtım yok → kayma yok) */}
          <div className="pointer-events-none relative mt-1.5 h-4 text-text-muted" aria-hidden="true">
            {xTicks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: pctX(t) }}>
                {shortDay(points[t]!.day)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-brand-600" aria-hidden="true" /> Gerçekleşen
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-5 border-t-2 border-dashed border-brand-600" aria-hidden="true" /> Tahmin
        </span>
        {minBalance != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-5 border-t-2 border-dashed border-amber-500" aria-hidden="true" /> En düşük bakiye eşiği {formatAccountMoney(minBalance, "TRY")}
          </span>
        ) : null}
      </div>
      <details className="text-xs">
        <summary className="inline-flex min-h-9 touch:min-h-11 cursor-pointer items-center font-semibold text-accent-text">Tablo olarak göster</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-canvas text-text-muted">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Gün</th>
                <th className="px-3 py-1.5 text-right font-semibold">Giriş</th>
                <th className="px-3 py-1.5 text-right font-semibold">Çıkış</th>
                <th className="px-3 py-1.5 text-right font-semibold">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.day} className="border-t border-line">
                  <td className="px-3 py-1.5">
                    <Link href={p.href} className="font-semibold text-accent-text hover:underline">
                      {shortDay(p.day)}
                    </Link>{" "}
                    {p.actual ? null : <span className="text-text-faint">tahmin</span>}
                  </td>
                  <td className="numeric px-3 py-1.5 text-right">{formatAccountMoney(p.inflow, "TRY")}</td>
                  <td className="numeric px-3 py-1.5 text-right">{formatAccountMoney(p.outflow, "TRY")}</td>
                  <td className="numeric px-3 py-1.5 text-right font-semibold">{formatAccountMoney(p.balance, "TRY")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
