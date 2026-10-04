import { computePurchaseCosts, type DeedFeeShare, type PurchaseCostLine } from "@/lib/purchase-costs";
import { hasEmpty, invalidKeys, optionalField, readField, val } from "./inputs";

export type PurchaseRaw = {
  price: string;
  deedTotalPct: string;
  deedShare: DeedFeeShare;
  serviceFee: string;
  commissionPct: string;
  vatPct: string;
};
export type PurchaseKey = "price" | "deedTotalPct" | "serviceFee" | "commissionPct" | "vatPct";

export type PurchaseToolResult =
  | { status: "empty" }
  | { status: "invalid"; fields: PurchaseKey[] }
  | { status: "ok"; lines: PurchaseCostLine[]; totalCosts: number; costsPctOfPrice: number; price: number };

/**
 * Yalnız kullanıcının girdiği veya koddaki tapu harcı oranıyla çalışır. Hizmet bedeli ve komisyon
 * boş gelir (boş = 0, kalem çıkmaz); DASK, sigorta, ekspertiz, yeni bina KDV'si hesaba KATILMAZ:
 * kodda doğrulanmış sabit tutar yok. Hesap `computePurchaseCosts` ile yapılır.
 */
export function computePurchaseTool(raw: PurchaseRaw): PurchaseToolResult {
  const f = {
    price: readField(raw.price, { positive: true }),
    deedTotalPct: readField(raw.deedTotalPct, { max: 100 }),
    serviceFee: optionalField(raw.serviceFee),
    commissionPct: optionalField(raw.commissionPct, { max: 100 }),
    vatPct: optionalField(raw.vatPct, { max: 100 }),
  };
  const bad = invalidKeys(f);
  if (bad.length) return { status: "invalid", fields: bad };
  if (hasEmpty(f, ["price", "deedTotalPct"])) return { status: "empty" };
  const r = computePurchaseCosts({
    price: val(f.price),
    deedFeeShare: raw.deedShare,
    commissionPct: val(f.commissionPct),
    vatPct: val(f.vatPct),
    includeDask: false,
    includeHomeInsurance: false,
    rates: { deedFeeTotalPct: val(f.deedTotalPct), landRegistryServiceFeeTry: val(f.serviceFee) },
  });
  return { status: "ok", lines: r.lines, totalCosts: r.totalCosts, costsPctOfPrice: r.costsPctOfPrice, price: r.price };
}
