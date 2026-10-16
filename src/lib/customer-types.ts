/**
 * MÜŞTERİ TÜRÜ — tek kanonik yazım (saf, vitest: customer-types.test.ts).
 *
 * Kanonik değerler tanım tablosunun varsayılanlarıdır (`DEFAULT_DEFINITIONS.customer_type`: Alıcı, Satıcı, Kiracı,
 * Mülk sahibi, Yatırımcı). Eski web formu/başvuru akışı ASCII küçük harf "alici" yazıyordu; müşteri türü
 * süzgecinde "Alıcı 70" yanında "alici 1" görünüyordu. Yazarken ve okurken aynı eşleme uygulanır; veritabanındaki eski
 * değerler `20261023030000_normalize_customer_types.sql` ile aynı eşlemeyle düzeltilir. Ofisin kendi eklediği özel
 * türler (eşlemede yoksa) kırpılıp aynen korunur.
 */

import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";

/** Kanonik liste tek kaynaktan (tanım varsayılanları); eşleme hedefleri bu listenin elemanlarıdır (test kilitler). */
export const CANONICAL_CUSTOMER_TYPES: readonly string[] = DEFAULT_DEFINITIONS.customer_type.map((d) => d.value);

/** Büyük/küçük harf, Türkçe karakter ve ayraç farkını yok sayan anahtar ("Mülk_Sahibi" → "mulk sahibi"). */
export function foldCustomerType(raw: string): string {
  return raw
    .trim()
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[\s_-]+/g, " ");
}

/** Eş anlamlılar (katlanmış anahtar → kanonik). SQL göçü bu tabloyla birebir aynıdır. */
export const CUSTOMER_TYPE_ALIASES: Readonly<Record<string, string>> = {
  alici: "Alıcı",
  buyer: "Alıcı",
  satici: "Satıcı",
  seller: "Satıcı",
  kiraci: "Kiracı",
  tenant: "Kiracı",
  "mulk sahibi": "Mülk sahibi",
  malik: "Mülk sahibi",
  "ev sahibi": "Mülk sahibi",
  owner: "Mülk sahibi",
  yatirimci: "Yatırımcı",
  investor: "Yatırımcı",
};

/** Tek değer: eşlemede varsa kanonik yazım, yoksa kırpılmış özgün değer; boşsa null. */
export function canonicalCustomerType(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  return CUSTOMER_TYPE_ALIASES[foldCustomerType(v)] ?? v;
}

/** Dizi: kanonikleştirir, boşları atar, tekrarı (sıra korunarak) kaldırır. */
export function normalizeCustomerTypes(raw: readonly (string | null | undefined)[] | null | undefined): string[] {
  const out: string[] = [];
  for (const r of raw ?? []) {
    const c = canonicalCustomerType(r);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}
