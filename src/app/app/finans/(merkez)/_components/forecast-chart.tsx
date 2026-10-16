"use client";

import { useState } from "react";
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
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

function shortDay(day: string) {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

export function ForecastChart({ points, minBalance }: { points: readonly ForecastChartPoint[]; minBalance: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  const values = points.map((p) => p.balance);
  const lo = Math.min(...values, minBalance ?? Infinity, 0);
  const hi = Math.max(...values, minBalance ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD_TOP + (1 - (v - lo) / span) * (H - PAD_TOP - PAD_BOTTOM);
  const path = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((p, k) => `${k === 0 ? "M" : "L"}${x(from + k).toFixed(1)},${y(p.balance).toFixed(1)}`)
      .join(" ");

  const lastActual = points.reduce((acc, p, i) => (p.actual ? i : acc), -1);
  const forecastFrom = Math.max(lastActual, 0);
  let lowIdx = forecastFrom;
  for (let i = forecastFrom; i < points.length; i++) if (points[i]!.balance < points[lowIdx]!.balance) lowIdx = i;
  const low = points[lowIdx]!;
  const breach = minBalance != null && low.balance < minBalance;
  const h = hover != null ? points[hover] : null;
  const ticks = [0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1];

  return (
    <div className="grid gap-2">
      <div className="relative" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[220px] w-full" aria-hidden="true">
          {/* Sıfır ve eşik çizgileri (silik ızgara) */}
          {lo < 0 ? <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-strong, currentColor)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} /> : null}
          {minBalance != null ? (
            <line x1={0} x2={W} y1={y(minBalance)} y2={y(minBalance)} stroke="var(--color-amber-500)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          ) : null}
          {/* Gerçekleşen bölge dolgusu (çok silik) */}
          {lastActual > 0 ? (
            <path d={`${path(0, lastActual)} L${x(lastActual).toFixed(1)},${H - PAD_BOTTOM} L0,${H - PAD_BOTTOM} Z`} fill="var(--brand-600)" opacity={0.08} />
          ) : null}
          {lastActual > 0 ? <path d={path(0, lastActual)} fill="none" stroke="var(--brand-600)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
          {forecastFrom < points.length - 1 ? (
            <path d={path(forecastFrom, points.length - 1)} fill="none" stroke="var(--brand-600)" strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ) : null}
          {h && hover != null ? <line x1={x(hover)} x2={x(hover)} y1={PAD_TOP} y2={H - PAD_BOTTOM} stroke="var(--text-faint, currentColor)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {/* İşaretçiler HTML'de (SVG oranı bozulsa da yuvarlak kalır) */}
        <span
          className={cn("pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", breach ? "bg-danger-500" : "bg-brand-600")}
          style={{ left: `${(x(lowIdx) / W) * 100}%`, top: `${(y(low.balance) / H) * 220}px` }}
        />
        {h && hover != null ? (
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600 ring-2 ring-surface" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.balance) / H) * 220}px` }} />
        ) : null}
        {/* Bugün ayracı: tahmin bölgesinin başı */}
        {lastActual >= 0 && lastActual < points.length - 1 ? (
          <span className="pointer-events-none absolute top-0 text-xs font-semibold text-text-muted" style={{ left: `calc(${(x(lastActual) / W) * 100}% + 4px)` }}>
            tahmin →
          </span>
        ) : null}
        {/* Gün bağlantıları: her gün tıklanabilir hedef (sıfır çıkmaz metrik) */}
        <div className="absolute inset-x-0 top-0 flex" style={{ height: H - PAD_BOTTOM }}>
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between text-xs text-text-faint">
          {ticks.map((t, k) => (
            <span key={`${t}-${k}`}>{shortDay(points[t]!.day)}</span>
          ))}
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
