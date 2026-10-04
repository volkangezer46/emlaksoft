import { calculateCommission } from "@/lib/commission";
import { hasEmpty, invalidKeys, optionalField, readField, val } from "./inputs";

export type CommissionRaw = { price: string; rate: string; vatRate: string; vatIncluded: boolean };
export type CommissionKey = "price" | "rate" | "vatRate";

export type CommissionToolResult =
  | { status: "empty" }
  | { status: "invalid"; fields: CommissionKey[] }
  | { status: "ok"; net: number; vat: number; gross: number; rate: number; vatRate: number };

/** Komisyon oranı ve KDV oranı kullanıcıdan gelir; "yasal/ortalama oran" varsayılmaz. */
export function computeCommissionTool(raw: CommissionRaw): CommissionToolResult {
  const f = {
    price: readField(raw.price, { positive: true }),
    rate: readField(raw.rate, { positive: true, max: 100 }),
    vatRate: optionalField(raw.vatRate, { max: 100 }),
  };
  const bad = invalidKeys(f);
  if (bad.length) return { status: "invalid", fields: bad };
  if (hasEmpty(f, ["price", "rate"])) return { status: "empty" };
  const b = calculateCommission({
    amount: val(f.price),
    rate: val(f.rate),
    vatRate: val(f.vatRate),
    vatIncluded: raw.vatIncluded,
  });
  return { status: "ok", net: b.net, vat: b.vat, gross: b.gross, rate: b.used.rate, vatRate: b.used.vatRate };
}
