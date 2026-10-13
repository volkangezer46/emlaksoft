import { niceTicks } from "./bar-columns";

/** Sunucu grafiklerinin (server-charts.tsx) saf ölçek yardımcıları; JSX içermez, birim testlidir. */

/** 0'ı içeren "güzel" eksen adımları (negatif değer destekli). Saf; test edilir. */
export function niceDomain(min: number, max: number, target = 4): number[] {
  const lo0 = Math.min(0, Number.isFinite(min) ? min : 0);
  const hi0 = Math.max(0, Number.isFinite(max) ? max : 0);
  const base = niceTicks(hi0 - lo0 || 1, target);
  const step = base.length > 1 ? base[1]! - base[0]! : 1;
  const lo = Math.floor(lo0 / step + 1e-9) * step;
  let hi = Math.ceil(hi0 / step - 1e-9) * step;
  if (hi <= lo) hi = lo + step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** En çok `max` eksen etiketi: ilk ve son her zaman, aradakiler eşit aralıkla. Saf; test edilir. */
export function axisLabelIndices(n: number, max = 6): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}
