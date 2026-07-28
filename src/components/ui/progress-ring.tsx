import { cn } from "@/lib/utils";

/**
 * ProgressRing — hedef/tamamlanma yüzdesi halkası (paketsiz, saf SVG).
 *
 * Hedefler, danışman KPI'ı ve ofis skoru gibi "yüzde" anlatan yerlerde
 * çubuk yerine halka: aynı alanda daha okunur ve ortadaki boşluk değeri
 * taşıyabiliyor.
 *
 * ERİŞİLEBİLİRLİK: SVG `role="img"` + `aria-label` taşır. Ekran okuyucu
 * "Hedef tamamlanma: %72" diye okur; grafiğin kendisi `aria-hidden` değildir
 * çünkü tek bilgi kaynağı odur.
 *
 * ANİMASYON: dolum `--dur-4` (320ms) sürer; `prefers-reduced-motion: reduce`
 * altında globals.css'teki genel kural süreyi sıfırlar, halka anında dolu gelir.
 */

const TONES = {
  brand: "var(--brand-600)",
  mint: "var(--mint-500)",
  amber: "var(--amber-500)",
  danger: "var(--danger-500)",
} as const;

export function ProgressRing({
  value,
  size = 64,
  thickness = 6,
  tone = "brand",
  label,
  caption,
  className,
}: {
  /** 0-100 arası yüzde; aralık dışı değerler kırpılır. */
  value: number;
  /** Piksel cinsinden dış çap (varsayılan 64). */
  size?: number;
  /** Halka kalınlığı (varsayılan 6). */
  thickness?: number;
  tone?: keyof typeof TONES;
  /** Ekran okuyucu etiketi — ör. "Aylık hedef tamamlanma". */
  label: string;
  /** Halkanın ortasında görünecek metin; verilmezse "%değer" yazılır. */
  caption?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;

  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: %${pct}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONES[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          style={{ transition: "stroke-dasharray var(--dur-4) var(--ease-out-expo)" }}
        />
      </svg>
      <span
        aria-hidden="true"
        className="numeric absolute font-display text-[13px] font-extrabold text-ink-950"
      >
        {caption ?? `%${pct}`}
      </span>
    </div>
  );
}
