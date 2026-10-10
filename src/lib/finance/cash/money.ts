import { formatMoney, formatTryDecimal } from "@/lib/format";

/** Hesap para biriminde tutar (TL: kuruşlu "1.234,50 ₺"; döviz: kuruşsuz). Tek biçimleyici: src/lib/format.ts. */
export function formatAccountMoney(amount: number, currency: string): string {
  if (currency === "USD" || currency === "EUR") return formatMoney(amount, currency);
  return formatTryDecimal(amount, 2);
}

/** Toplamları para birimine göre ayırır (farklı para birimleri toplanmaz). */
export function sumByCurrency(rows: readonly { currency: string; amount: number }[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, Math.round(((totals.get(r.currency) ?? 0) + r.amount) * 100) / 100);
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => (a.currency === "TRY" ? -1 : b.currency === "TRY" ? 1 : a.currency.localeCompare(b.currency)));
}
