/**
 * Tutar/oran/tarih yardımcıları (SAF). Türk biçimleri ("1.250,50"), makine biçimleri ("1250.50") ve ÖKC fişlerinin
 * yıldızlı tutarları ("*1.250,00") desteklenir. OCR'nin sık karıştırdığı karakterler yalnız SAYI bağlamında düzeltilir.
 */
import { parseTrAmount } from "@/lib/finance/ocr/parse-receipt";

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Makine biçimi ("1000.00", "92", 1080) → sayı; negatif/sonsuz → null. Karekod/XML içindir (binlik ayraç beklenmez). */
export function parseMachineAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  const s = String(value).trim().replace(/\s/g, "");
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return parseTrAmount(s);
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

/** Bir metin satırında geçen tutar adayları (soldan sağa). "1.250,00", "*208,33", "1,250.00", "1250,5" tanınır. */
const AMOUNT_RE = /(?<![\d.,])(?:\d{1,3}(?:[.,’']\d{3})+|\d+)(?:[.,]\d{1,2})(?![.,]?\d)/g;

/** OCR sayı düzeltmesi: rakamlar arasındaki O/o → 0, l/I/| → 1, S → 5, B → 8 (yalnız rakam komşuluğunda). */
export function fixOcrDigits(input: string): string {
  let s = input;
  // Kurallar birbirini besler ("1.25O,OO" → "1.250,OO" → "1.250,00"): değişim bitene dek (en çok 3 tur).
  for (let i = 0; i < 3; i++) {
    const next = s
      .replace(/(?<=\d)[Oo](?=[\d.,])|(?<=[\d.,])[Oo](?=\d)/g, "0")
      .replace(/(\d[.,])([0-9Oo]{2})(?![\wçğıöşüÇĞİÖŞÜ])/g, (_m, a: string, b: string) => a + b.replace(/[Oo]/g, "0"))
      .replace(/(?<=\d)[lI|](?=[\d.,])|(?<=[\d.,])[lI|](?=\d)/g, "1")
      .replace(/(?<=\d[.,]?)S(?=\d)/g, "5")
      .replace(/(?<=\d)B(?=\d)/g, "8")
      .replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g, "$1$2$3")
      .replace(/(\d[.,])\s+(\d{2})(?!\d)/g, "$1$2");
    if (next === s) break;
    s = next;
  }
  return s;
}

export function amountsInLine(line: string): number[] {
  const out: number[] = [];
  const s = fixOcrDigits(line);
  for (const m of s.matchAll(AMOUNT_RE)) {
    const raw = m[0].replace(/[’']/g, ".");
    const n = parseTrAmount(raw);
    if (n != null) out.push(n);
  }
  return out;
}

/** Türkiye'de görülen KDV oranları (geçmiş %8/%18 dahil; belge 1 yıldan eski olabilir). */
export const KNOWN_VAT_RATES = [0, 1, 8, 10, 18, 20] as const;

export function isKnownVatRate(n: number): boolean {
  return (KNOWN_VAT_RATES as readonly number[]).includes(n);
}

export function approxEqual(a: number, b: number, tolerance?: number): boolean {
  const tol = tolerance ?? Math.max(0.05, Math.abs(b) * 0.005);
  return Math.abs(a - b) <= tol;
}

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
};

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Metindeki tüm tarih adayları (sıra korunur): 12.09.2026, 12/09/26, 2026-09-12, 12 Eylül 2026. */
export function datesInLine(line: string, fold: (s: string) => string): string[] {
  const out: string[] = [];
  const s = fixOcrDigits(line);
  for (const m of s.matchAll(/(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g)) {
    const v = validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v) out.push(v);
  }
  for (const m of s.matchAll(/(?<![\d.])(\d{1,2})\s?[-./]\s?(\d{1,2})\s?[-./]\s?(\d{4}|\d{2})(?![\d])/g)) {
    const yy = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const v = validYmd(yy, Number(m[2]), Number(m[1]));
    if (v) out.push(v);
  }
  const folded = fold(line);
  for (const m of folded.matchAll(/(?<!\d)(\d{1,2}) (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik) (\d{4})(?!\d)/g)) {
    const v = validYmd(Number(m[3]), MONTHS[m[2]!]!, Number(m[1]));
    if (v) out.push(v);
  }
  return out;
}

/** Türkçe katlama: küçük harf, aksan kaldırma, harf/rakam dışı → boşluk. */
export function foldTr(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dayDiff(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${aIso}T00:00:00Z`) - Date.parse(`${bIso}T00:00:00Z`)) / 86_400_000);
}
