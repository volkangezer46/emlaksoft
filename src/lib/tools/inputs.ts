import { parseTrNumber } from "@/lib/roi-calculator";

/**
 * Public araçlar için ortak girdi okuma. Ayrıştırma `roi-calculator.parseTrNumber` ile aynıdır
 * ("1.500.000" ve "3,5" okunur); boş ve geçersiz ayrı durumlardır, NaN sızmaz.
 */
export type Field = { state: "empty" } | { state: "invalid" } | { state: "ok"; value: number };

export function readField(raw: string, opts: { min?: number; max?: number; positive?: boolean } = {}): Field {
  if (!raw.trim()) return { state: "empty" };
  const n = parseTrNumber(raw);
  if (n === null) return { state: "invalid" };
  if (opts.positive && n <= 0) return { state: "invalid" };
  if (opts.min != null && n < opts.min) return { state: "invalid" };
  if (opts.max != null && n > opts.max) return { state: "invalid" };
  return { state: "ok", value: n };
}

/** Boş alan = 0 (isteğe bağlı alanlar için); geçersiz kalır. */
export function optionalField(raw: string, opts: { min?: number; max?: number } = {}): Field {
  const f = readField(raw, opts);
  return f.state === "empty" ? { state: "ok", value: 0 } : f;
}

export function invalidKeys<K extends string>(fields: Record<K, Field>): K[] {
  return (Object.keys(fields) as K[]).filter((k) => fields[k].state === "invalid");
}

export function hasEmpty<K extends string>(fields: Record<K, Field>, required: K[]): boolean {
  return required.some((k) => fields[k].state === "empty");
}

export function val(f: Field): number {
  return f.state === "ok" ? f.value : 0;
}
