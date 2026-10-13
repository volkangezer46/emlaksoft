import { describe, expect, it } from "vitest";
import { LEGAL_CONSTANTS } from "./index";
import { activeRecord, isDayKey, nextScheduled, resolveAllLegalValues, resolveLegalValue, type LegalConstantRecord } from "./history";

const rec = (key: string, value: number, validFrom: string): LegalConstantRecord => ({ key, value, validFrom });

describe("mevzuat sabiti geçerlilik geçmişi", () => {
  it("kayıt yoksa koddaki değer", () => {
    expect(resolveLegalValue("vatGeneralPct", [], "2026-10-13")).toBe(LEGAL_CONSTANTS.vatGeneralPct.value);
  });

  it("geleceğe tarihli değer o tarihe kadar UYGULANMAZ; o gün ve sonrasında uygulanır", () => {
    const records = [rec("deedFeeTotalPct", 5, "2027-01-01")];
    expect(resolveLegalValue("deedFeeTotalPct", records, "2026-12-31")).toBe(LEGAL_CONSTANTS.deedFeeTotalPct.value);
    expect(resolveLegalValue("deedFeeTotalPct", records, "2027-01-01")).toBe(5);
    expect(resolveLegalValue("deedFeeTotalPct", records, "2027-06-30")).toBe(5);
    expect(nextScheduled("deedFeeTotalPct", records, "2026-12-31")?.value).toBe(5);
    expect(nextScheduled("deedFeeTotalPct", records, "2027-01-01")).toBeNull();
  });

  it("geçmiş: verilen günde en yeni yürürlükteki kayıt; eski tarihli değer sonraki değişiklikle biter", () => {
    const records = [rec("valueGainExemptionTry", 120_000, "2025-01-01"), rec("valueGainExemptionTry", 150_000, "2026-01-01"), rec("valueGainExemptionTry", 190_000, "2027-01-01")];
    expect(resolveLegalValue("valueGainExemptionTry", records, "2024-12-31")).toBe(LEGAL_CONSTANTS.valueGainExemptionTry.value);
    expect(resolveLegalValue("valueGainExemptionTry", records, "2025-06-01")).toBe(120_000);
    expect(resolveLegalValue("valueGainExemptionTry", records, "2026-10-13")).toBe(150_000);
    expect(activeRecord("valueGainExemptionTry", records, "2026-10-13")?.validFrom).toBe("2026-01-01");
    expect(resolveLegalValue("valueGainExemptionTry", records, "2027-01-02")).toBe(190_000);
  });

  it("başka anahtarın kaydı ve bozuk tarih/değer yok sayılır", () => {
    const records = [rec("daskMinTry", 1, "2020-01-01"), rec("vatGeneralPct", 18, "2026-13-01"), { key: "vatGeneralPct", value: Number.NaN, validFrom: "2020-01-01" }];
    expect(resolveLegalValue("vatGeneralPct", records, "2026-10-13")).toBe(LEGAL_CONSTANTS.vatGeneralPct.value);
    expect(resolveAllLegalValues(records, "2026-10-13").daskMinTry).toBe(1);
  });

  it("gün anahtarı doğrulaması", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("26-02-01")).toBe(false);
  });
});

describe("tarihli değer hesaplayıcıya gerçekten yansır", () => {
  it("satıcı net hesabı o günün kaydını kullanır (öncesinde kod değeri)", async () => {
    const { computeSellerProceeds } = await import("@/lib/seller-proceeds");
    const records = [rec("deedFeeTotalPct", 6, "2027-01-01")];
    const input = { salePrice: 1_000_000, acquisitionPrice: 900_000, holdingMonths: 72 };
    const before = computeSellerProceeds({ ...input, legal: resolveAllLegalValues(records, "2026-12-31") });
    const after = computeSellerProceeds({ ...input, legal: resolveAllLegalValues(records, "2027-01-01") });
    expect(before.deedFee).toBe((1_000_000 * LEGAL_CONSTANTS.deedFeeTotalPct.value) / 100 / 2);
    expect(after.deedFee).toBe(30_000);
  });

  it("alım maliyeti oranları o günün kaydını kullanır", async () => {
    const { computePurchaseCosts, purchaseRatesFromLegal } = await import("@/lib/purchase-costs");
    const records = [rec("landRegistryServiceFeeTry", 7_500, "2026-01-01")];
    const rates = purchaseRatesFromLegal(resolveAllLegalValues(records, "2026-10-13"));
    expect(rates.landRegistryServiceFeeTry).toBe(7_500);
    const withDb = computePurchaseCosts({ price: 2_000_000, downPayment: 2_000_000, rates });
    const withCode = computePurchaseCosts({ price: 2_000_000, downPayment: 2_000_000 });
    expect(withDb.totalCosts - withCode.totalCosts).toBe(7_500 - LEGAL_CONSTANTS.landRegistryServiceFeeTry.value);
  });

  it("DATED_LEGAL_KEYS listesindeki her sabit bir hesaplayıcı çıktısını değiştirir (liste yalan söylemez)", async () => {
    const { DATED_LEGAL_KEYS } = await import("./index");
    const { purchaseRatesFromLegal } = await import("@/lib/purchase-costs");
    const { computeSellerProceeds } = await import("@/lib/seller-proceeds");
    const base = purchaseRatesFromLegal();
    // Satıcı tarafı: 5 yıl içinde, yüksek kazanç, ÜFE eşiği üstü, DKV eşiğine yakın satış.
    const sellerInput = { salePrice: 20_000_000, acquisitionPrice: 2_000_000, holdingMonths: 30, ufeIncreasePct: 12 };
    const sellerBase = JSON.stringify(computeSellerProceeds(sellerInput));
    for (const k of DATED_LEGAL_KEYS) {
      const v = { [k]: LEGAL_CONSTANTS[k].value * 3 + 7 };
      const purchaseChanged = JSON.stringify(purchaseRatesFromLegal(v)) !== JSON.stringify(base);
      const sellerChanged = JSON.stringify(computeSellerProceeds({ ...sellerInput, legal: v })) !== sellerBase;
      expect(purchaseChanged || sellerChanged, k).toBe(true);
    }
  });

  it("hesaplayıcı sayfaları değerleri sunucuda okuyup istemciye geçirir", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/app/app/hesaplayici/seller-view.tsx", "src/app/app/hesaplayici/calculator-view.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/getEffectiveLegalValues\(\)/);
    }
  });
});
