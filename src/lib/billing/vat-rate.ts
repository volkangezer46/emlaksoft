import "server-only";

import { getSetting } from "@/lib/settings/read";
import { DEFAULT_BILLING_VAT_RATE, DEFAULT_VAT_SCHEDULE, parseVatSchedule, vatRateAt, type VatRateEntry } from "@/lib/billing/plans";
import { now, trDayKey } from "@/lib/clock";

/** Ayar defterindeki geçerlilik tarihli KDV kayıtları (`billing.vat_rate`); okunamazsa kod varsayılanı. */
export async function getVatSchedule(): Promise<VatRateEntry[]> {
  try {
    const raw = await getSetting<string>("billing.vat_rate");
    return parseVatSchedule(raw) ?? parseVatSchedule(DEFAULT_VAT_SCHEDULE)!;
  } catch {
    return parseVatSchedule(DEFAULT_VAT_SCHEDULE)!;
  }
}

/**
 * Faturalama KDV oranı OKUYUCUSU (sunucu): verilen andaki (varsayılan: şimdi, TR günü) geçerli oran. `BILLING_VAT_RATE`
 * sabiti yalnız kod varsayılanıdır; kesilen elle VE otomatik fatura (abonelik, ek kullanıcı, analiz paketi, yönetici fark
 * faturası) oranı buradan alır ve faturaya yazar (`resolveAutoInvoiceVatRate`, fulfillment.ts).
 */
export async function getBillingVatRate(atMs: number = now()): Promise<number> {
  return vatRateAt(await getVatSchedule(), trDayKey(atMs), DEFAULT_BILLING_VAT_RATE);
}
