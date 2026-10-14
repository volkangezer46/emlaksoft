/**
 * Otomatik kesilen faturaların (abonelik, ek kullanıcı, analiz paketi, paket yükseltme, yönetici fark faturası) tutar
 * kuralı — SAF (I/O yok; sunucu, istemci ön izlemesi ve test ortak).
 *
 * KDV oranı ÇAĞIRANDAN gelir: sunucu fatura keserken ayar defterindeki geçerlilik tarihli oranı okur
 * (`resolveAutoInvoiceVatRate`, fulfillment.ts) ve faturaya `meta.vatRate` olarak YAZAR. Ödeme doğrulaması (iyzico
 * callback/webhook, fulfill SQL'i) oranı yeniden okumaz, faturadaki orandan hesaplar (`invoiceVatRateOf`): kesimden sonra
 * oran değişse de doğrulama bozulmaz, eski fatura eski oranında kalır. Oranı yazılmamış (bu kuraldan önceki) fatura %20'dir.
 */
import { DEFAULT_BILLING_VAT_RATE } from "@/lib/billing/plans";
import { invoiceLineDescription } from "@/lib/billing/manual-invoice";

/** Geçerli KDV oranı: 0 <= oran < 1 (0,2 = %20). */
export function isValidVatRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate < 1;
}

/** Net tutardan fatura tutarları: KDV = net × oran (kuruşa yuvarlı), toplam = net + KDV. Fulfill SQL'i aynı yuvarlamayı yapar. */
export function invoiceAmountsTry(netAmountTry: number, vatRate: number = DEFAULT_BILLING_VAT_RATE) {
  if (!Number.isFinite(netAmountTry) || netAmountTry <= 0) {
    throw new Error("Fatura tutarı geçersiz.");
  }
  if (!isValidVatRate(vatRate)) throw new Error("KDV oranı geçersiz.");
  const amountTry = Math.round(netAmountTry * 100) / 100;
  const taxTry = Math.round(amountTry * vatRate * 100) / 100;
  const totalTry = Math.round((amountTry + taxTry) * 100) / 100;
  return { amountTry, taxTry, totalTry };
}

/**
 * Faturanın kesildiği andaki KDV oranı (`meta.vatRate`). Yoksa/bozuksa kod varsayılanı (%20): oran yazılmadan önce kesilen
 * faturalar sabit %20 ile kesilmişti. SQL karşılığı `public.billing_invoice_vat_rate(meta)` (20261014012000) aynı kuraldır.
 */
export function invoiceVatRateOf(meta: unknown): number {
  const raw = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>).vatRate : undefined;
  return isValidVatRate(raw) ? raw : DEFAULT_BILLING_VAT_RATE;
}

/** Otomatik faturanın `invoice_lines` satırı (tek kalem; AD2 ile aynı biçim: açıklama meta'dan, miktar 1). */
export function autoInvoiceLineRow(input: {
  invoiceId: string;
  tenantId: string;
  meta: unknown;
  amounts: { amountTry: number; taxTry: number; totalTry: number };
  vatRate: number;
}) {
  return {
    invoice_id: input.invoiceId,
    tenant_id: input.tenantId,
    position: 1,
    description: invoiceLineDescription(input.meta),
    quantity: 1,
    unit_net_try: input.amounts.amountTry,
    vat_rate: input.vatRate,
    net_try: input.amounts.amountTry,
    tax_try: input.amounts.taxTry,
    total_try: input.amounts.totalTry,
  };
}
