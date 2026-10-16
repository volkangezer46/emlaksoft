import { formatMoney, formatTry, formatTryKurus } from "@/lib/format";

/**
 * Hesap para biriminde tutar. TL ₺ önekli (uygulamanın geri kalanıyla aynı): tam sayı kuruşsuz ("₺1.913.395"), kuruşlu
 * tutar iki haneli ("₺2.650,60" — "₺2.650,6" değil). Döviz kuruşsuz. Tek biçimleyici: src/lib/format.ts.
 */
export function formatAccountMoney(amount: number, currency: string): string {
  if (currency === "USD" || currency === "EUR") return formatMoney(amount, currency);
  const cents = Math.round(amount * 100);
  const v = cents / 100 || 0;
  return cents % 100 === 0 ? formatTry(v) : formatTryKurus(v);
}

/** Toplamları para birimine göre ayırır (farklı para birimleri toplanmaz). */
export function sumByCurrency(rows: readonly { currency: string; amount: number }[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, Math.round(((totals.get(r.currency) ?? 0) + r.amount) * 100) / 100);
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => (a.currency === "TRY" ? -1 : b.currency === "TRY" ? 1 : a.currency.localeCompare(b.currency)));
}

/**
 * KURUŞ POLİTİKASI (tek kural): özet kart / KPI / gösterge rakamı TAM TL ("₺58.351"), kuruş YALNIZ defter satırında,
 * ekstrede, fişte ve tutar girişinde (`formatAccountMoney`). Eskiden bazı kartlarda "₺58.351,11", bazılarında "₺592.051"
 * görünüyordu. Döviz kuruşsuz (formatAccountMoney ile aynı).
 */
export function formatKpiMoney(amount: number, currency = "TRY"): string {
  if (currency === "USD" || currency === "EUR") return formatMoney(amount, currency);
  return formatTry(Math.round(Number.isFinite(amount) ? amount : 0) || 0);
}
