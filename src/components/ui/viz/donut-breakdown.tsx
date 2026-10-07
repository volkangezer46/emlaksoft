import Link from "@/components/ui/smart-link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DonutRing } from "./donut-ring";
import { formatViz, vizToneColor, type VizTone } from "./colors";

/**
 * DonutBreakdown (viz) — halka + lejant tablosu (renk noktası · ad · sayı · yüzde). Sunucu-güvenli, Recharts YOK;
 * halka tek setten (`DonutRing`, tüp derinliği). Her lejant satırı `href` ile filtrelenmiş listeye gider
 * (sıfır çıkmaz metrik); `active` seçili filtreyi gösterir. Toplam 0 ise halka çizilmez, `empty` gösterilir.
 */
export type BreakdownItem = { key: string; label: string; value: number; tone?: VizTone; color?: string; href?: string; active?: boolean; title?: string };

/** Yüzdeler: en büyük kalan yöntemiyle toplam tam 100 (yuvarlama kayması yok). Saf; test edilir. */
export function percentShares(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return clean.map(() => 0);
  const raw = clean.map((v) => (v / total) * 100);
  const floor = raw.map(Math.floor);
  let rest = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    if ((clean[i] ?? 0) > 0) {
      floor[i] = (floor[i] ?? 0) + 1;
      rest -= 1;
    }
  }
  return floor;
}

export function DonutBreakdown({
  items,
  ariaLabel,
  center,
  size = 156,
  stroke = 20,
  empty,
  className,
}: {
  items: readonly BreakdownItem[];
  ariaLabel: string;
  center?: ReactNode;
  size?: number;
  stroke?: number;
  empty?: ReactNode;
  className?: string;
}) {
  const shares = percentShares(items.map((i) => i.value));
  const colored = items.map((it, i) => ({ ...it, fill: it.color ?? vizToneColor(it.tone, i) }));
  const total = items.reduce((a, b) => a + (Number.isFinite(b.value) ? Math.max(0, b.value) : 0), 0);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-4", className)}>
      {total > 0 ? (
        <DonutRing segments={colored.map((c) => ({ label: c.label, value: c.value, color: c.fill }))} size={size} stroke={stroke} ariaLabel={ariaLabel}>
          {center}
        </DonutRing>
      ) : (
        <div className="grid shrink-0 place-items-center text-center text-sm text-text-muted" style={{ width: size, height: size }}>
          {empty ?? "Veri yok"}
        </div>
      )}
      <div className="viz-legend min-w-[12rem] flex-1">
        {colored.map((c, i) => {
          const row = (
            <>
              <span className="viz-legend-name">
                <span className="viz-legend-dot" style={{ background: c.fill }} aria-hidden="true" />
                <span className="truncate">{c.label}</span>
              </span>
              <span className="viz-legend-n">{formatViz(c.value)}</span>
              <span className="viz-legend-pct">%{shares[i]}</span>
            </>
          );
          return c.href ? (
            <Link
              key={c.key}
              href={c.href}
              className="focus-ring"
              aria-current={c.active ? "true" : undefined}
              title={c.title}
              aria-label={`${c.label}: ${formatViz(c.value)} (%${shares[i]})${c.title ? `. ${c.title}` : ""}`}
            >
              {row}
            </Link>
          ) : (
            <div key={c.key}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}
