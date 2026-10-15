import { formatMoney } from "@/lib/format";

/**
 * Herkese açık ilan fiyatı (SK8 B094 sözleşme f): vitrin, ilan detayı, paylaşım, sunum, önizleme kartı ve JSON-LD
 * fiyatı ilanın para biriminden (`properties.features.currency`: TL | USD | EUR) `formatMoney` ile basar. Para birimi
 * yoksa ya da tanınmıyorsa TRY. Döviz ilanda TL varsayan kur satırı (fxApproxLine) public yüzeyde basılmaz.
 */
export type ListingCurrency = "TRY" | "USD" | "EUR";

export function listingCurrency(features: unknown): ListingCurrency {
  const raw = features && typeof features === "object" ? (features as { currency?: unknown }).currency : null;
  const c = String(raw ?? "").trim().toUpperCase();
  if (c === "USD" || c === "$") return "USD";
  if (c === "EUR" || c === "€") return "EUR";
  return "TRY";
}

export function isRentTransaction(tx: string | null | undefined): boolean {
  const t = (tx ?? "").toLowerCase();
  return t === "rent" || t.includes("kira");
}

/** "₺1.250.000", "$850.000", kiralıkta "/ay" eki; fiyat yoksa `empty`. */
export function formatPublicPrice(
  amount: number | null | undefined,
  tx: string | null | undefined,
  currency: ListingCurrency,
  empty = "Fiyat için sorun",
): string {
  if (amount == null || !Number.isFinite(amount)) return empty;
  const s = formatMoney(amount, currency);
  return isRentTransaction(tx) ? `${s}/ay` : s;
}
