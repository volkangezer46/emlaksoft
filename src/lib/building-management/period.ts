/** Dönem (ay) yardımcıları (SAF). Tarihler `YYYY-MM-DD` (TR günü) olarak dışarıdan verilir. */

/** `YYYY-MM-DD` → `YYYY-MM`. */
export const monthKeyOf = (day: string): string => day.slice(0, 7);

/** `YYYY-MM` biçimi geçerli mi? */
export const isMonthKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** `YYYY-MM` + n ay. */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
