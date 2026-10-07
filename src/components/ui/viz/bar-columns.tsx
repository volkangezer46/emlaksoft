import Link from "@/components/ui/smart-link";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { formatViz, vizToneColor, type VizFormat, type VizTone } from "./colors";

/**
 * BarColumns (viz) — kategori sütunları (paket dağılımı, durum kırılımı…). Saf HTML/CSS, sunucu-güvenli, Recharts YOK.
 * Derinlik dili viz.css token'larıyla (`--viz-sheen` üst ışık, `--viz-shade` yan/alt gölge, `--viz-shadow` taban);
 * ilk görünümde sütun bir kez büyür (reduce'ta durağan). Varsayılan ton altın (sayım/para vurgusu).
 *
 * Sıfır çıkmaz metrik: `href` verilen sütun bağlantıdır (filtrelenmiş liste); `active` seçili sütunu vurgular
 * (`aria-current`). Erişilebilirlik: her sütunun adı + değeri bağlantı metninde; eksen dekoratif.
 * Yalnız gerçek veri: hiç kategori yoksa `null`.
 */
export type BarColumn = { label: string; value: number; href?: string; active?: boolean; tone?: VizTone; title?: string };

/** 0'dan başlayan "güzel" eksen adımları (1-2-5 ölçeği), en az 1 adım. Saf; test edilir. */
export function niceTicks(max: number, target = 4): number[] {
  const m = Number.isFinite(max) && max > 0 ? max : 1;
  const raw = m / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? pow * 10;
  const s = Math.max(step, m < target ? 1 : step);
  const top = Math.ceil(m / s) * s;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += s) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export function BarColumns({
  data,
  ariaLabel,
  height = 200,
  format = "number",
  tone = "gold",
  className,
}: {
  data: readonly BarColumn[];
  ariaLabel: string;
  height?: number;
  format?: VizFormat;
  tone?: VizTone;
  className?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(0, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  return (
    <div className={cn("viz-cols", className)} style={{ height }} role="group" aria-label={ariaLabel}>
      <div className="viz-cols-axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{formatViz(t, format)}</span>
        ))}
      </div>
      <div className="viz-cols-plot">
        <div className="viz-cols-grid" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} />
          ))}
        </div>
        {data.map((d, i) => {
          const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
          const pct = (v / top) * 100;
          const style = { "--t": vizToneColor(d.tone ?? tone, i) } as CSSProperties;
          const body = (
            <>
              <span className="viz-col-bar" style={{ height: `${pct}%` }} aria-hidden="true">
                <span className="viz-col-val">{formatViz(v, format)}</span>
              </span>
              <span className="viz-col-label" aria-hidden="true">
                {d.label}
              </span>
            </>
          );
          const label = `${d.label}: ${formatViz(v, format)}`;
          return d.href ? (
            <Link
              key={d.label}
              href={d.href}
              className="viz-col focus-ring"
              style={style}
              aria-current={d.active ? "true" : undefined}
              aria-label={d.title ? `${label}. ${d.title}` : label}
              title={d.title}
            >
              {body}
            </Link>
          ) : (
            <div key={d.label} className="viz-col" style={style} aria-label={label} role="img">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
