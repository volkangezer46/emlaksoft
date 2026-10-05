import { invoiceAmountsTry } from "@/lib/billing/fulfillment";
import { efPackUnitPriceTry, type EfPack, type EfTariff } from "@/lib/ef-credits/config";

/**
 * KONTÖR PAKETİ SATIN ALMA: SAF ÇEKİRDEK (I/O yok).
 * Ekran önizlemesi ve bağlayıcı sunucu hesabı AYNI fonksiyonları kullanır; istemciden tutar/kontör alınmaz.
 * KDV kuralı tek kaynaktan gelir: `invoiceAmountsTry` (net x 1,20).
 */

export type CreditPackQuote = {
  packId: string;
  units: number;
  netTry: number;
  taxTry: number;
  totalTry: number;
  /** Kontör başı net / KDV dahil fiyat. */
  unitNetTry: number;
  unitGrossTry: number;
};

export function quoteCreditPack(pack: Pick<EfPack, "id" | "units" | "priceNetTry">): CreditPackQuote {
  const a = invoiceAmountsTry(pack.priceNetTry);
  return {
    packId: pack.id,
    units: pack.units,
    netTry: a.amountTry,
    taxTry: a.taxTry,
    totalTry: a.totalTry,
    unitNetTry: efPackUnitPriceTry(pack),
    unitGrossTry: pack.units > 0 ? Math.round((a.totalTry / pack.units) * 100) / 100 : 0,
  };
}

/** Yalnız AKTİF paket satılır; bulunamazsa null. */
export function findPurchasablePack(packs: EfPack[], packId: string): EfPack | null {
  return packs.find((p) => p.id === packId && p.active) ?? null;
}

/** Fatura meta sözleşmesi (fulfill SQL'i okur): { kind, packId, units, priceNetTry }. */
export function buildCreditPackMeta(pack: Pick<EfPack, "id" | "units" | "priceNetTry">) {
  return { kind: "credit_pack" as const, packId: pack.id, units: pack.units, priceNetTry: pack.priceNetTry };
}

export function activePacks(packs: EfPack[]): EfPack[] {
  return packs.filter((p) => p.active);
}

/** Tarifedeki en ucuz ÜCRETLİ (>0) işlemin kontörü; hiç ücretli kalem yoksa null. */
export function cheapestPaidUnits(tariff: EfTariff): number | null {
  const paid = [tariff.valuationArsa, tariff.valuationKonut, tariff.pdfFirst, tariff.reportDetail].filter((n) => n > 0);
  return paid.length > 0 ? Math.min(...paid) : null;
}

export type LowBalanceState = "empty" | "low" | "ok";

/** Eşik = en ucuz ücretli işlemin 2 katı. Bakiye <= 0 "empty"; <= eşik "low". */
export function lowBalanceState(available: number, tariff: EfTariff): { state: LowBalanceState; threshold: number } {
  const cheapest = cheapestPaidUnits(tariff);
  const threshold = cheapest === null ? 0 : cheapest * 2;
  if (available <= 0) return { state: "empty", threshold };
  if (cheapest !== null && available <= threshold) return { state: "low", threshold };
  return { state: "ok", threshold };
}

/** Paket önerisi: işaretli "popüler" aktif paket; yoksa eşiği en az 5 kez karşılayan en küçük paket; yoksa en büyük. */
export function suggestPack(packs: EfPack[], tariff: EfTariff): EfPack | null {
  const act = activePacks(packs).sort((a, b) => a.units - b.units);
  if (act.length === 0) return null;
  const popular = act.find((p) => p.popular);
  if (popular) return popular;
  const need = (cheapestPaidUnits(tariff) ?? 1) * 5;
  return act.find((p) => p.units >= need) ?? act[act.length - 1]!;
}

export function creditPackBasketName(pack: Pick<EfPack, "name" | "units">): string {
  return `EmlakSoft kontör paketi: ${pack.name} (${pack.units} kontör)`;
}
