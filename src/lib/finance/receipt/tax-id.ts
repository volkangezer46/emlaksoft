/**
 * VKN (10 hane) ve TCKN (11 hane) sağlama doğrulaması (SAF). GİB/NVİ'nin yayımladığı algoritmalar:
 *  - VKN: ilk 9 hanenin her biri için t = (d + 9 - i) mod 10; t = 9 ise 9, değilse (t * 2^(9 - i)) mod 9; toplamın
 *    (10 - toplam mod 10) mod 10 değeri 10. haneye eşit olmalı.
 *  - TCKN: ilk hane 0 olamaz; 10. hane = ((tekler * 7) - çiftler) mod 10; 11. hane = ilk 10 hane toplamı mod 10.
 */

export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(value[i]) + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const c10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (c10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

export type TaxIdKind = "vkn" | "tckn";

/** Rakam dışını atar; 10 hane VKN, 11 hane TCKN. Geçerlilik ayrıca döner (geçersiz de olsa değer korunur, uyarı üretilir). */
export function classifyTaxId(raw: string | null | undefined): { value: string; kind: TaxIdKind; valid: boolean } | null {
  if (!raw) return null;
  const v = String(raw).replace(/\D/g, "");
  if (v.length === 10) return { value: v, kind: "vkn", valid: isValidVkn(v) };
  if (v.length === 11) return { value: v, kind: "tckn", valid: isValidTckn(v) };
  return null;
}

/** Test ve örnek veri için: ilk 9 haneden geçerli VKN üretir. */
export function vknWithChecksum(first9: string): string {
  if (!/^\d{9}$/.test(first9)) throw new Error("9 hane gerekli");
  for (let c = 0; c <= 9; c++) {
    const v = `${first9}${c}`;
    if (isValidVkn(v)) return v;
  }
  throw new Error("unreachable");
}
