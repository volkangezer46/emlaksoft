/**
 * Türkçe tutar girişi (SAF; ağ, saat, DOM yok). Yeni kayıt penceresi ve tek satır akıllı giriş aynı kuralı kullanır.
 *
 * Kabul edilen biçimler:
 *  - "1.234,56" (nokta binlik, virgül ondalık) · "1234,5" · "4.500" (3'lü gruplar = binlik) · "48000"
 *  - kısaltmalar: "48k" / "48 bin" = 48.000 · "1,2m" / "1,2 mn" / "1,2 milyon" = 1.200.000
 *  - "1.5" gibi 3'lü gruba uymayan tek nokta ondalık sayılır (yapıştırılan İngilizce biçim).
 * Geçersiz, negatif ya da sıfır tutar `null` döner (sahte tutar üretilmez).
 */

const SUFFIX: Record<string, number> = {
  k: 1_000,
  b: 1_000,
  bin: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  milyon: 1_000_000,
};

/** Kısaltma son ekleri (en uzundan kısaya; regex alternatifinde sıra önemli). */
export const AMOUNT_SUFFIX_PATTERN = "milyon|bin|mn|k|b|m";

/** Sayı gövdesini (son eksiz) Türkçe kurallarla sayıya çevirir. */
function parseNumberBody(raw: string): number | null {
  const s = raw.replace(/\s+/g, "").replace(/[₺]|tl$/gi, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let normalized: string;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // Son ayraç ondalıktır: "1.234,56" (TR) ya da "1,234.56" (EN yapıştırma).
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length > 2) {
      // "1,234,567": yalnız 3'lü gruplarla binlik kabul edilir.
      if (!/^\d{1,3}(,\d{3})+$/.test(s)) return null;
      normalized = s.replace(/,/g, "");
    } else normalized = s.replace(",", ".");
  } else if (hasDot) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s.split(".").length === 2 ? s : "";
  } else normalized = s;
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Serbest metindeki tutarı sayıya çevirir: "1.234,56" → 1234.56, "48k" → 48000, "1,2m" → 1200000.
 * Kuruş 2 haneye yuvarlanır. Sıfır/negatif/anlamsız girişte `null`.
 */
export function parseAmountShorthand(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLocaleLowerCase("tr-TR").replace(/\s*(₺|tl|try)$/i, "").trim();
  if (!s) return null;
  const m = new RegExp(`^(\\d[\\d.,\\s]*?)\\s*(${AMOUNT_SUFFIX_PATTERN})?$`).exec(s);
  if (!m) return null;
  const body = parseNumberBody(m[1]!);
  if (body == null) return null;
  const mult = m[2] ? SUFFIX[m[2]]! : 1;
  const value = Math.round(body * mult * 100) / 100;
  return value > 0 && value < 1e13 ? value : null;
}

/** Tutarı Türkçe biçimde yazar (girişe geri yazmak için): 1234.5 → "1.234,50"; tam sayıda kuruş yazılmaz. */
export function formatAmountInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(value);
}
