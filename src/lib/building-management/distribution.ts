/**
 * Bina aidatı / ortak gider DAĞITIM hesabı (SAF; saat, DB ve ağ okumaz). Sunucu action'ı bu fonksiyonla payları hesaplar,
 * `create_building_batch` RPC'si toplamı ve daire kümesini doğrular. Tüm hesap kuruş (tam sayı) üzerinden yapılır.
 *
 * Yöntemler:
 *  - equal      : eşit (her daire aynı pay)
 *  - land_share : arsa payı ağırlıklı
 *  - area       : brüt m² ağırlıklı
 *  - fixed      : her dairenin kendi sabit tutarı (toplam = sabit tutarların toplamı; girilen toplam verilirse eşleşmeli)
 *
 * Kuruş yuvarlama farkı SON daireye eklenir (toplam her zaman birebir tutar); son dairenin payı sıfır/negatif olacaksa hata döner.
 */
import { fromKurus, toKurus } from "@/lib/property-management/payments";

export const DISTRIBUTION_METHODS = ["equal", "land_share", "area", "fixed"] as const;
export type DistributionMethod = (typeof DISTRIBUTION_METHODS)[number];

export const DISTRIBUTION_LABELS: Record<DistributionMethod, string> = {
  equal: "Eşit",
  land_share: "Arsa payı",
  area: "Metrekare (m²)",
  fixed: "Sabit tutar (daire bazlı)",
};

export function isDistributionMethod(v: unknown): v is DistributionMethod {
  return typeof v === "string" && (DISTRIBUTION_METHODS as readonly string[]).includes(v);
}

export type DistributionUnit = {
  id: string;
  /** Görünen ad (hata mesajları için): "A Blok · 3". */
  label?: string;
  areaM2?: number | null;
  landShare?: number | null;
  fixedAmount?: number | null;
};

export type Share = { unitId: string; amount: number };

export type DistributionResult =
  | { ok: true; total: number; shares: Share[]; roundingAdjustment: number }
  | { ok: false; error: string };

const unitName = (u: DistributionUnit) => u.label ?? u.id;

/** Ağırlıklı dağıtım: pay = yuvarla(toplam × ağırlık / ağırlıkToplamı); fark son daireye. */
function weighted(totalK: number, units: readonly DistributionUnit[], weights: readonly number[]): DistributionResult {
  const sumW = weights.reduce((a, b) => a + b, 0);
  const amountsK = weights.map((w) => Math.round((totalK * w) / sumW));
  const diff = totalK - amountsK.reduce((a, b) => a + b, 0);
  const last = amountsK.length - 1;
  amountsK[last] = amountsK[last]! + diff;
  if (amountsK.some((k) => k <= 0)) {
    return { ok: false, error: "Tutar bu dairelere bölünemeyecek kadar küçük (en az bir dairenin payı 1 kuruşun altında kalıyor)." };
  }
  return {
    ok: true,
    total: fromKurus(totalK),
    shares: units.map((u, i) => ({ unitId: u.id, amount: fromKurus(amountsK[i]!) })),
    roundingAdjustment: fromKurus(diff),
  };
}

export function distributeAmount(input: {
  method: DistributionMethod;
  /** Dağıtılacak toplam (TL). `fixed` için isteğe bağlı: verilirse sabit tutarların toplamıyla eşleşmeli. */
  total?: number | null;
  /** Sıra önemlidir: yuvarlama farkı sondaki daireye eklenir (blok/kat/numara sırası önerilir). */
  units: readonly DistributionUnit[];
}): DistributionResult {
  const { method, units } = input;
  if (units.length === 0) return { ok: false, error: "Dağıtım için en az bir daire gerekir." };
  if (new Set(units.map((u) => u.id)).size !== units.length) return { ok: false, error: "Aynı daire birden fazla kez seçilmiş." };

  if (method === "fixed") {
    const missing = units.filter((u) => !(typeof u.fixedAmount === "number" && u.fixedAmount > 0));
    if (missing.length > 0) return { ok: false, error: `Sabit tutarı olmayan daireler: ${missing.map(unitName).join(", ")}.` };
    const amountsK = units.map((u) => toKurus(u.fixedAmount as number));
    const sumK = amountsK.reduce((a, b) => a + b, 0);
    if (input.total != null && toKurus(input.total) !== sumK) {
      return { ok: false, error: "Girilen toplam, dairelerin sabit tutarlarının toplamıyla eşleşmiyor." };
    }
    return { ok: true, total: fromKurus(sumK), shares: units.map((u, i) => ({ unitId: u.id, amount: fromKurus(amountsK[i]!) })), roundingAdjustment: 0 };
  }

  const totalK = toKurus(input.total ?? 0);
  if (!(totalK >= 1)) return { ok: false, error: "Dağıtılacak tutarı girin." };
  if (totalK > 1_000_000_000 * 100) return { ok: false, error: "Tutar çok büyük." };

  if (method === "equal") {
    const n = units.length;
    const base = Math.floor(totalK / n);
    const amountsK = units.map(() => base);
    const diff = totalK - base * n;
    amountsK[n - 1] = amountsK[n - 1]! + diff;
    if (base <= 0) return { ok: false, error: "Tutar bu dairelere bölünemeyecek kadar küçük (en az bir dairenin payı 1 kuruşun altında kalıyor)." };
    return { ok: true, total: fromKurus(totalK), shares: units.map((u, i) => ({ unitId: u.id, amount: fromKurus(amountsK[i]!) })), roundingAdjustment: fromKurus(diff) };
  }

  const pick = method === "land_share" ? (u: DistributionUnit) => u.landShare : (u: DistributionUnit) => u.areaM2;
  const missing = units.filter((u) => !(typeof pick(u) === "number" && (pick(u) as number) > 0));
  if (missing.length > 0) {
    const what = method === "land_share" ? "Arsa payı" : "Metrekaresi";
    return { ok: false, error: `${what} girilmemiş daireler: ${missing.map(unitName).join(", ")}.` };
  }
  return weighted(totalK, units, units.map((u) => pick(u) as number));
}

/** Daire sıralama anahtarı: blok, kat, numara (doğal sıra). Yuvarlama farkı sondaki daireye gideceğinden sıra kararlı olmalı. */
export function compareUnits(
  a: { block?: string | null; floor?: number | null; unitNo: string; id: string },
  b: { block?: string | null; floor?: number | null; unitNo: string; id: string },
): number {
  const blockCmp = (a.block ?? "").localeCompare(b.block ?? "", "tr", { numeric: true });
  if (blockCmp !== 0) return blockCmp;
  const floorCmp = (a.floor ?? -999) - (b.floor ?? -999);
  if (floorCmp !== 0) return floorCmp;
  const noCmp = a.unitNo.localeCompare(b.unitNo, "tr", { numeric: true });
  return noCmp !== 0 ? noCmp : a.id < b.id ? -1 : 1;
}

export function unitLabel(u: { block?: string | null; unitNo: string }): string {
  return u.block ? `${u.block} · ${u.unitNo}` : `Daire ${u.unitNo}`;
}
