import { hasEmpty, invalidKeys, optionalField, readField, val } from "./inputs";

export type YieldRaw = { price: string; monthlyRent: string; yearlyExpenses: string };
export type YieldKey = "price" | "monthlyRent" | "yearlyExpenses";

export type YieldResult =
  | { status: "empty" }
  | { status: "invalid"; fields: YieldKey[] }
  | {
      status: "ok";
      price: number;
      yearlyRent: number;
      grossYieldPct: number;
      grossPaybackYears: number;
      hasExpenses: boolean;
      netYieldPct: number | null;
      netPaybackYears: number | null;
    };

/**
 * Brüt getiri (%) = yıllık kira / fiyat × 100; geri dönüş (yıl) = fiyat / yıllık kira.
 * Net: (yıllık kira − yıllık gider) / fiyat. Fiyat artışı, enflasyon, kira artışı ve boş kalma
 * süresi MODELLENMEZ (gider alanına kullanıcı kendi tahminini yazabilir).
 */
export function computeRentalYield(raw: YieldRaw): YieldResult {
  const f = {
    price: readField(raw.price, { positive: true }),
    monthlyRent: readField(raw.monthlyRent, { positive: true }),
    yearlyExpenses: optionalField(raw.yearlyExpenses),
  };
  const bad = invalidKeys(f);
  if (bad.length) return { status: "invalid", fields: bad };
  if (hasEmpty(f, ["price", "monthlyRent"])) return { status: "empty" };
  const price = val(f.price);
  const yearlyRent = val(f.monthlyRent) * 12;
  const expenses = val(f.yearlyExpenses);
  const net = yearlyRent - expenses;
  return {
    status: "ok",
    price,
    yearlyRent,
    grossYieldPct: (yearlyRent / price) * 100,
    grossPaybackYears: price / yearlyRent,
    hasExpenses: expenses > 0,
    netYieldPct: expenses > 0 ? (net / price) * 100 : null,
    netPaybackYears: expenses > 0 && net > 0 ? price / net : null,
  };
}
