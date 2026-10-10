/**
 * Fatura hesapları ve doğrulama (SAF; DOM/ağ/zaman yok). Tutarlar KDV hariç birim fiyattan türer.
 * Mevzuat (KDV oranı, e-fatura mükellefiyeti) yalnız bilgi amaçlıdır; burada engel değil, biçim denetimi vardır.
 */
import type {
  EInvoiceBuyer,
  EInvoiceDocType,
  EInvoiceLine,
  EInvoiceSourceType,
} from "./types";

export const DEFAULT_VAT_RATE = 20;
/** Seçici için yaygın oranlar (kullanıcı seçer; başka oran API'ye gitmez). */
export const VAT_RATE_OPTIONS = [0, 1, 10, 20] as const;
export const MAX_LINES = 50;
export const MAX_DESCRIPTION = 300;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type LineAmounts = { net: number; vat: number; gross: number };

export function lineAmounts(line: EInvoiceLine): LineAmounts {
  const net = round2(line.quantity * line.unitPrice);
  const vat = round2((net * line.vatRate) / 100);
  return { net, vat, gross: round2(net + vat) };
}

export type InvoiceTotals = {
  net: number;
  vat: number;
  gross: number;
  /** KDV oranına göre KDV toplamı (ör. { 20: 25600 }). */
  vatByRate: Record<number, number>;
};

export function computeTotals(lines: readonly EInvoiceLine[]): InvoiceTotals {
  let net = 0;
  let vat = 0;
  const vatByRate: Record<number, number> = {};
  for (const line of lines) {
    const a = lineAmounts(line);
    net += a.net;
    vat += a.vat;
    vatByRate[line.vatRate] = round2((vatByRate[line.vatRate] ?? 0) + a.vat);
  }
  net = round2(net);
  vat = round2(vat);
  return { net, vat, gross: round2(net + vat), vatByRate };
}

const DIGITS = /^\d+$/;

export function isValidTaxId(value: string): boolean {
  return DIGITS.test(value) && (value.length === 10 || value.length === 11);
}

/** 10 hane = VKN (tüzel), 11 hane = TCKN (gerçek kişi). */
export function taxIdKind(value: string): "vkn" | "tckn" | null {
  if (!DIGITS.test(value)) return null;
  if (value.length === 10) return "vkn";
  if (value.length === 11) return "tckn";
  return null;
}

/** Tür seçimi (saf kural): mükellef -> e-fatura, değil -> e-arşiv. e-SMM yalnız açıkça istenirse. */
export function decideDocType(isEInvoiceUser: boolean | null, wantSmm = false): EInvoiceDocType {
  if (wantSmm) return "e-smm";
  return isEInvoiceUser ? "e-fatura" : "e-arsiv";
}

export type DraftInput = {
  buyer: EInvoiceBuyer;
  lines: EInvoiceLine[];
  issueDate: string;
};

export type DraftValidation = { ok: true } | { ok: false; error: string };

/** Taslak biçim denetimi (sağlayıcıya gitmeden önce; kullanıcıya Türkçe, basit mesaj). */
export function validateDraftInput(input: DraftInput): DraftValidation {
  const { buyer, lines, issueDate } = input;
  if (!buyer.name.trim()) return { ok: false, error: "Alıcı adı gerekli." };
  if (!isValidTaxId(buyer.taxId)) return { ok: false, error: "Vergi kimlik no (10 hane) ya da TC kimlik no (11 hane) rakamlarla girilmeli." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return { ok: false, error: "Fatura tarihi geçerli değil." };
  if (lines.length === 0) return { ok: false, error: "En az bir fatura kalemi gerekli." };
  if (lines.length > MAX_LINES) return { ok: false, error: `En fazla ${MAX_LINES} kalem eklenebilir.` };
  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    if (!line.description.trim()) return { ok: false, error: `${n}. kalemin açıklaması boş.` };
    if (line.description.length > MAX_DESCRIPTION) return { ok: false, error: `${n}. kalemin açıklaması çok uzun.` };
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return { ok: false, error: `${n}. kalemin miktarı sıfırdan büyük olmalı.` };
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) return { ok: false, error: `${n}. kalemin birim fiyatı geçerli değil.` };
    if (!Number.isFinite(line.vatRate) || line.vatRate < 0 || line.vatRate > 100) return { ok: false, error: `${n}. kalemin KDV oranı geçerli değil.` };
  }
  const totals = computeTotals(lines);
  if (totals.net <= 0) return { ok: false, error: "Fatura tutarı sıfırdan büyük olmalı." };
  return { ok: true };
}

/** Kaynak+tür başına tek fatura: benzersiz anahtar. Serbest faturada kaynak yok, taslak kimliği kullanılır. */
export function idempotencyKey(sourceType: EInvoiceSourceType, sourceId: string | null, freeId?: string): string {
  if (sourceType === "free") return `free:${freeId ?? sourceId ?? "x"}:invoice`;
  return `${sourceType}:${sourceId ?? "x"}:invoice`;
}

/**
 * Komisyon tutarından KDV oranı çıkarımı (önceden doldurma için): oran seçenekleri arasına oturuyorsa o,
 * yoksa varsayılan. Kullanıcı yine seçer.
 */
export function inferVatRate(gross: number, vat: number): number {
  if (!(gross > 0) || !(vat >= 0)) return DEFAULT_VAT_RATE;
  const pct = (vat / gross) * 100;
  const match = VAT_RATE_OPTIONS.find((r) => Math.abs(r - pct) < 0.51);
  return match ?? DEFAULT_VAT_RATE;
}
