import { PRICE_DROP_MIN_PCT } from "./thresholds";

export type PriceChange = {
  /** Fiyat eşik üstünde düştü mü. */
  dropped: boolean;
  /** Pozitif yüzde (düşüş miktarı), düşmediyse null. */
  dropPct: number | null;
  /** Yükseliş kaydedilir ama sinyal değildir. */
  raised: boolean;
};

/** İki ardışık gözlem arasındaki fiyat değişimi (SAF). Eksik/geçersiz fiyat = değişim yok. */
export function evaluatePriceChange(prev: number | null | undefined, next: number | null | undefined): PriceChange {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!ok(prev) || !ok(next) || prev === next) return { dropped: false, dropPct: null, raised: ok(prev) && ok(next) && next > prev };
  if (next > prev) return { dropped: false, dropPct: null, raised: true };
  const pct = Math.round(((prev - next) / prev) * 1000) / 10;
  if (pct < PRICE_DROP_MIN_PCT) return { dropped: false, dropPct: null, raised: false };
  return { dropped: true, dropPct: pct, raised: false };
}
