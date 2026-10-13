/**
 * Fiş okuma (FN5) — SAF yardımcılar. Model yanıtını (JSON) güvenli bir ÖNERİYE çevirir; hiçbir değer kayıt
 * oluşturmaz, yalnız "Yeni kayıt" penceresini önceden doldurur (kullanıcı onaylamadan hareket yok).
 *
 * Kural: emin olunmayan alan null kalır. Tutar pozitif ve makul aralıkta, tarih geçerli bir takvim günü
 * (gelecekte 2 günden ileri değil), KDV oranı yalnız %1 / %10 / %20, satıcı 2..120 karakter.
 */

export type ReceiptSuggestion = {
  amount?: number;
  /** YYYY-MM-DD */
  date?: string;
  vatRate?: 1 | 10 | 20;
  vendor?: string;
};

export const RECEIPT_OCR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const RECEIPT_MAX_AMOUNT = 100_000_000;

export function isReceiptOcrType(fileType: string): boolean {
  return (RECEIPT_OCR_TYPES as readonly string[]).includes(fileType);
}

/** OCR çalışmalı mı: ayar açık, görsel tür ve kota açık. Kapalıysa HİÇBİR dış çağrı yapılmaz. */
export function shouldRunReceiptOcr(input: { enabled: boolean; fileType: string; quotaOpen: boolean }): boolean {
  if (!input.enabled) return false;
  if (!isReceiptOcrType(input.fileType)) return false;
  return input.quotaOpen;
}

/** "1.250,50" / "1,250.50" / "1250.5" / "₺ 1.250" → sayı. Belirsizse null. */
export function parseTrAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 && value < RECEIPT_MAX_AMOUNT ? round2(value) : null;
  let s = String(value).replace(/[^\d.,-]/g, "").trim();
  if (!s || s.startsWith("-")) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Son ayraç ondalıktır.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Yalnız virgül: tek virgül + 1-2 hane = ondalık (TR); 3'lü gruplar = binlik; diğerleri belirsiz.
    if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else return null;
  } else if (lastDot >= 0) {
    const dots = s.match(/\./g)?.length ?? 0;
    const tail = s.length - lastDot - 1;
    if (dots > 1 || tail === 3) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < RECEIPT_MAX_AMOUNT ? round2(n) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "12.05.2026", "12/05/2026", "2026-05-12", "12.05.26" → "2026-05-12". `todayIso` sonrasına 2 günden fazla düşerse null. */
export function parseReceiptDate(value: unknown, todayIso: string): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  let out: string | null = null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) out = validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/.exec(s);
    if (m) {
      const yy = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      out = validYmd(yy, Number(m[2]), Number(m[1]));
    }
  }
  if (!out) return null;
  const limit = addDaysIso(todayIso, 2);
  return limit && out > limit ? null : out;
}

function addDaysIso(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

/** Yalnız TR'de geçerli KDV oranları; "%20", "20", "0.20", 18 (eski) → null. */
export function parseVatRate(value: unknown): 1 | 10 | 20 | null {
  if (value == null) return null;
  let n = typeof value === "number" ? value : Number(String(value).replace(/[%\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1) n = Math.round(n * 100);
  return n === 1 || n === 10 || n === 20 ? n : null;
}

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/gu;

/** Satıcı adı: kontrol karakteri ve maske yer tutucusu ([TELEFON_1] vb.) içeren değer reddedilir. */
export function parseVendor(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.toLowerCase() === "null") return null;
  if (/\[[A-Z_]+_\d+\]/.test(s)) return null;
  return s.slice(0, 120);
}

/** Model yanıtını (JSON metni ya da kod bloğu) öneriye çevirir; okunamazsa boş öneri. */
export function parseReceiptResponse(raw: string | null | undefined, todayIso: string): ReceiptSuggestion {
  if (!raw) return {};
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: Record<string, unknown>;
  try {
    const v = JSON.parse(cleaned) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    parsed = v as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: ReceiptSuggestion = {};
  const amount = parseTrAmount(parsed.toplam ?? parsed.amount);
  if (amount != null) out.amount = amount;
  const date = parseReceiptDate(parsed.tarih ?? parsed.date, todayIso);
  if (date) out.date = date;
  const vat = parseVatRate(parsed.kdv_orani ?? parsed.vat_rate);
  if (vat != null) out.vatRate = vat;
  const vendor = parseVendor(parsed.satici ?? parsed.vendor);
  if (vendor) out.vendor = vendor;
  return out;
}

/** Önerinin dolu alan sayısı (arayüz "3 alan okundu" der). */
export function suggestionFieldCount(s: ReceiptSuggestion | null | undefined): number {
  if (!s) return 0;
  return (s.amount != null ? 1 : 0) + (s.date ? 1 : 0) + (s.vatRate != null ? 1 : 0) + (s.vendor ? 1 : 0);
}

/** Depolama yolu için güvenli ad: ASCII, [A-Za-z0-9._-], en çok 80 karakter, uzantı korunur. */
export function safeObjectName(name: string, ext: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base || "belge"}.${ext}`;
}
