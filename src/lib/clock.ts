/**
 * Zaman okumaları — tek kaynak.
 *
 * Neden ayrı modül: `Date.now()` bir bileşen gövdesinde doğrudan çağrıldığında
 * React Compiler'ın saflık kuralı (react-hooks/purity) uyarır. Uyarı client
 * tarafında haklıdır — her render farklı değer üretir. Server Component'lerde
 * ise istek başına bir kez değerlendiği için doğru kullanımdır.
 *
 * Bu niyeti 15 ayrı `eslint-disable` yorumuyla bastırmak yerine, zaman
 * okumasını adlandırılmış yardımcılara topladık. Kazanç iki yönlü:
 *  - Çağrı yerleri ne sorduklarını söylüyor: `isPast(x)`, `daysAgoIso(90)`.
 *  - `new Date(Date.now() - N * 86_400_000).toISOString()` gibi tekrarlayan
 *    aritmetik tek yerde kaldı.
 *
 * Yuvarlama bilinçli olarak çağrı yerinde bırakıldı (`Math.ceil` / `Math.floor`
 * kullanımları arasında fark var); bu modül ham milisaniye döndürür.
 */

export const DAY_MS = 86_400_000;

type DateInput = string | number | Date;

function ms(value: DateInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Şu anın epoch milisaniyesi. */
export function now(): number {
  return Date.now();
}

/** `days` gün öncesinin ISO karşılığı — Supabase `gte`/`lte` filtreleri için. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** `days` gün sonrasının ISO karşılığı — vade/pencere hesapları için. */
export function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** Verilen andan bu yana geçen milisaniye (geçmiş için pozitif). */
export function msSince(value: DateInput): number {
  return Date.now() - ms(value);
}

/** Verilen ana kalan milisaniye (gelecek için pozitif). */
export function msUntil(value: DateInput): number {
  return ms(value) - Date.now();
}

/** Verilen an geçmişte mi. Geçersiz/boş değer `false` sayılır. */
export function isPast(value: DateInput | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  const t = ms(value);
  return Number.isNaN(t) ? false : t < Date.now();
}
