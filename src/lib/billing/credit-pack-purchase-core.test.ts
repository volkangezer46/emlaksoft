import { describe, expect, it } from "vitest";
import {
  buildCreditPackMeta,
  cheapestPaidUnits,
  findPurchasablePack,
  lowBalanceState,
  quoteCreditPack,
  suggestPack,
} from "@/lib/billing/credit-pack-purchase-core";
import { EF_DEFAULT_TARIFF, type EfPack } from "@/lib/ef-credits/config";

const pack = (o: Partial<EfPack> & Pick<EfPack, "id" | "units" | "priceNetTry">): EfPack => ({
  name: o.id,
  months: 1,
  active: true,
  order: 10,
  ...o,
});

describe("kontör paketi fiyat/KDV", () => {
  it("net x %20 KDV, kontör başı net ve brüt", () => {
    const q = quoteCreditPack({ id: "std", units: 25, months: 3, priceNetTry: 390 });
    expect(q).toMatchObject({ months: 3, netTry: 390, taxTry: 78, totalTry: 468, unitNetTry: 15.6, unitGrossTry: 18.72 });
  });
  it("kuruş yuvarlaması", () => {
    const q = quoteCreditPack({ id: "x1", units: 3, months: 1, priceNetTry: 10.01 });
    expect(q.totalTry).toBe(12.01);
  });
  it("yalnız aktif paket satılır", () => {
    const packs = [pack({ id: "a1", units: 10, priceNetTry: 100, active: false }), pack({ id: "b1", units: 20, priceNetTry: 150 })];
    expect(findPurchasablePack(packs, "a1")).toBeNull();
    expect(findPurchasablePack(packs, "b1")?.id).toBe("b1");
    expect(findPurchasablePack(packs, "yok")).toBeNull();
  });
  it("fatura meta sözleşmesi", () => {
    expect(buildCreditPackMeta({ id: "std", units: 25, months: 6, priceNetTry: 390 })).toEqual({
      kind: "credit_pack",
      packId: "std",
      units: 25,
      priceNetTry: 390,
      // ef_credit_grant faturadan okur: kontörün son kullanma tarihini belirler.
      validityMonths: 6,
    });
  });
});

describe("düşük bakiye eşiği", () => {
  it("eşik en ucuz ücretli işlemin 2 katı (0 olanlar sayılmaz)", () => {
    expect(cheapestPaidUnits({ ...EF_DEFAULT_TARIFF, valuationArsa: 5, valuationKonut: 4 })).toBe(4);
    expect(cheapestPaidUnits({ valuationArsa: 0, valuationKonut: 0, valuationTicari: 1050 })).toBeNull();
  });
  it("durumlar", () => {
    const t = { valuationArsa: 5, valuationKonut: 2, valuationTicari: 1050 };
    expect(lowBalanceState(0, t)).toEqual({ state: "empty", threshold: 4 });
    expect(lowBalanceState(4, t).state).toBe("low");
    expect(lowBalanceState(5, t).state).toBe("ok");
  });
  it("tüm işlemler ücretsizse yalnız 0 bakiye uyarır", () => {
    const t = { valuationArsa: 0, valuationKonut: 0, valuationTicari: 1050 };
    expect(lowBalanceState(1, t).state).toBe("ok");
    expect(lowBalanceState(0, t).state).toBe("empty");
  });
});

describe("paket önerisi", () => {
  const t = { valuationArsa: 5, valuationKonut: 3, valuationTicari: 1050 };
  it("katalog boşsa null", () => expect(suggestPack([], t)).toBeNull());
  it("popüler varsa o", () => {
    const p = [pack({ id: "s1", units: 10, priceNetTry: 100 }), pack({ id: "s2", units: 25, priceNetTry: 200, popular: true })];
    expect(suggestPack(p, t)?.id).toBe("s2");
  });
  it("yoksa eşiği 5 kez karşılayan en küçük (3x5=15)", () => {
    const p = [pack({ id: "s1", units: 10, priceNetTry: 100 }), pack({ id: "s2", units: 25, priceNetTry: 200 })];
    expect(suggestPack(p, t)?.id).toBe("s2");
  });
  it("pasif paket önerilmez", () => {
    const p = [pack({ id: "s1", units: 100, priceNetTry: 100, active: false })];
    expect(suggestPack(p, t)).toBeNull();
  });
});
