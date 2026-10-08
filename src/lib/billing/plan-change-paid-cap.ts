/**
 * Oransal yükseltme kredisi için "son ödenen düz yenileme" seçimi (saf).
 * Satırlar `paid_at` azalan sırayla gelir. Ek koltuk / kontör faturaları atlanır; son anlamlı fatura bir yükseltme
 * faturasıysa kredi liste fiyatından hesaplanır (null): yükseltme sonrası dönem artık yeni paketin fiyatındadır.
 */
export type PaidInvoiceRow = { amount_try: number | string | null; meta?: Record<string, unknown> | null };

export function pickPaidCapNetTry(rows: readonly PaidInvoiceRow[]): number | null {
  for (const row of rows) {
    const kind = row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>).kind : undefined;
    if (kind === "extra_seats" || kind === "credit_pack") continue;
    if (kind === "plan_upgrade") return null;
    const amount = Number(row.amount_try);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  return null;
}
