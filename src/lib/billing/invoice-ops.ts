/** Fatura/ödeme işlemleri için saf doğrulama yardımcıları (sunucu ve test ortak). */

export const MANUAL_PAYMENT_METHODS = [
  { value: "havale", label: "Havale / EFT" },
  { value: "nakit", label: "Nakit" },
  { value: "kart_pos", label: "POS / kart (elle)" },
  { value: "diger", label: "Diğer" },
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number]["value"];

export const MAX_MONEY_TRY = 10_000_000;

/** "1.234,56" veya "1234.56" -> 1234.56; negatif, sıfır, 2'den fazla ondalık ve aşırı değer null. */
export function parseMoneyTry(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "").replace(/₺|TRY|TL/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MONEY_TRY) return null;
  return Math.round(n * 100) / 100;
}

/** Boş tutar = tam fatura tutarı. Kısmi iade serbest ama toplamı aşamaz. */
export function validateRefundAmount(raw: string, invoiceTotal: number): { value: number } | { error: string } {
  const text = raw.trim();
  if (!text) return { value: Math.round(invoiceTotal * 100) / 100 };
  const n = parseMoneyTry(text);
  if (n === null) return { error: "İade tutarı geçersiz (pozitif, en fazla 2 ondalık)." };
  if (n > invoiceTotal + 0.01) return { error: "İade tutarı fatura tutarını aşamaz." };
  return { value: n };
}
