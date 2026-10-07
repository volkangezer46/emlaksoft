import Link from "next/link";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatViz, vizToneColor, type VizFormat, type VizTone } from "./colors";
import { TubeGradient } from "./tube-gradient";

/**
 * DonutRing (viz) — çok dilimli halka (pay dağılımı: danışman/ofis payı, kanal kırılımı...). Saf SVG, sunucu-güvenli,
 * istemci bileşeninde de kullanılabilir (hesaplayıcılar). Recharts GEREKTİRMEZ (ipucu gerekmeyen küçük halkalar için;
 * etkileşimli/ipuçlu dağılım: `ui/lazy-charts` `DonutSplit`).
 *
 * - Dilimler `pathLength=1` ile çizilir; değer değişince uzunluk/konum akıcı geçer (viz.css `.viz-ring-seg`, reduce'ta anlık).
 * - Derinlik: halkanın üstünde tek "tüp" degradesi (iç kenar gölge → dış kenar ışık; `TubeGradient`, token `--viz-shade/--viz-sheen`).
 * - Yalnız gerçek veri: toplam <= 0 ise `null` (çağıran boş durum gösterir). Dilim rengi `color` (token) ya da `tone`.
 * - `href` verilen dilim fareyle tıklanınca filtreli listeye gider (sıfır çıkmaz metrik). SVG aria-hidden olduğundan
 *   dilim bağlantısı odak sırasına girmez (tabIndex -1); klavye/ekran okuyucu yolu çağıranın lejant bağlantılarıdır.
 * - Erişilebilirlik: role="img" + her dilimin adı, değeri ve yüzdesi sr-only metinde; merkez içerik (`children`) görseldir.
 */
export type DonutSegment = { label: string; value: number; color?: string; tone?: VizTone; href?: string };

export function DonutRing({
  segments,
  size = 160,
  stroke = 16,
  gap = 0.008,
  format = "number",
  ariaLabel,
  children,
  className,
}: {
  segments: readonly DonutSegment[];
  size?: number;
  stroke?: number;
  /** Dilimler arası boşluk (çevre oranı). */
  gap?: number;
  format?: VizFormat;
  ariaLabel: string;
  children?: ReactNode;
  className?: string;
}) {
  const tubeId = `viz-tube-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const clean = segments.map((s) => ({ ...s, value: Number.isFinite(s.value) ? Math.max(0, s.value) : 0 }));
  const total = clean.reduce((a, s) => a + s.value, 0);
  if (!(total > 0)) return null;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const visible = clean.filter((s) => s.value > 0).length;
  const fracs = clean.map((s) => s.value / total);
  const arcs = clean.map((s, i) => {
    const frac = fracs[i]!;
    const start = fracs.slice(0, i).reduce((a, f) => a + f, 0);
    const len = Math.max(0, frac - (visible > 1 && frac > 0 ? gap : 0));
    return { s, color: s.color ?? vizToneColor(s.tone, i), len, start };
  });
  const summary = `${ariaLabel}: ${clean
    .map((s) => `${s.label} ${formatViz(s.value, format)} (%${Math.round((s.value / total) * 100)})`)
    .join(", ")}`;

  return (
    <div role="img" aria-label={summary} className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90 overflow-visible">
        <defs>
          <TubeGradient id={tubeId} cx={cx} cy={cx} inner={r - stroke / 2} outer={r + stroke / 2} />
        </defs>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        {arcs.map((a, i) => {
          if (!(a.len > 0)) return null;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              pathLength={1}
              strokeDasharray={`${a.len.toFixed(4)} 1`}
              strokeDashoffset={(-a.start).toFixed(4)}
              className="viz-ring-seg"
            />
          );
          return a.s.href ? (
            <Link key={i} href={a.s.href} tabIndex={-1} className="viz-ring-link">
              {seg}
            </Link>
          ) : (
            seg
          );
        })}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={`url(#${tubeId})`} strokeWidth={stroke} pointerEvents="none" />
      </svg>
      {children ? <div className="absolute inset-0 grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}
