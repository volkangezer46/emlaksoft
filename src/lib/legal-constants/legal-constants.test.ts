import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DKV_BRACKETS,
  INCOME_TAX_BRACKETS,
  LEGAL_CONSTANTS,
  allLegalConstants,
  describeLegal,
  isLegalVerified,
  legalValue,
  progressiveTax,
} from "./index";
import { DEFAULT_RATES, MAX_LOAN_MONTHS, MAX_LOAN_TO_VALUE_PCT } from "../purchase-costs";
import { DEFAULT_CAP_VAT_RATE, DEFAULT_RENT_CAP_MONTHS, DEFAULT_SALE_CAP_RATE } from "../commission-cap";
import { DEFAULT_VAT_RATE } from "../commission";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("mevzuat sabitleri tek kaynak", () => {
  it("her sabitin kaynağı ve tutarlı doğrulama durumu var", () => {
    for (const [key, k] of Object.entries(LEGAL_CONSTANTS)) {
      expect(k.source.length, key).toBeGreaterThan(3);
      expect(k.label.length, key).toBeGreaterThan(3);
      expect(Number.isFinite(k.value), key).toBe(true);
      // verified yalnız tarihle birlikte geçerli; tarihsiz verified yok.
      if (k.status === "verified") expect(k.verifiedAt, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(k.verifiedAt, key).toBeNull();
    }
    for (const t of [INCOME_TAX_BRACKETS, DKV_BRACKETS]) {
      expect(t.source.length).toBeGreaterThan(3);
      expect(t.brackets.at(-1)!.upTo).toBeNull();
    }
  });

  it("doğrulanmamış sabit rozetsiz 'doğrulandı' sayılmaz", () => {
    expect(isLegalVerified({ status: "verified", verifiedAt: null })).toBe(false);
    expect(isLegalVerified({ status: "unverified", verifiedAt: "2026-10-06" })).toBe(false);
    expect(isLegalVerified({ status: "verified", verifiedAt: "2026-10-06" })).toBe(true);
    expect(describeLegal("deedFeeTotalPct").verified).toBe(false);
    expect(allLegalConstants().every((i) => !i.verified)).toBe(true);
  });

  it("purchase-costs ve komisyon modülleri aynı sabitleri kullanır", () => {
    expect(DEFAULT_RATES.deedFeeTotalPct).toBe(legalValue("deedFeeTotalPct"));
    expect(DEFAULT_RATES.landRegistryServiceFeeTry).toBe(legalValue("landRegistryServiceFeeTry"));
    expect(DEFAULT_RATES.vatPct).toBe(legalValue("vatGeneralPct"));
    expect(DEFAULT_RATES.commissionPct).toBe(legalValue("saleCommissionCapPct") / 2);
    expect(DEFAULT_RATES.newBuildVatLargePct).toBe(legalValue("newBuildVatLargePct"));
    expect(MAX_LOAN_MONTHS).toBe(legalValue("maxLoanMonths"));
    expect(MAX_LOAN_TO_VALUE_PCT).toBe(legalValue("maxLtvPct"));
    expect(DEFAULT_SALE_CAP_RATE).toBe(legalValue("saleCommissionCapPct"));
    expect(DEFAULT_RENT_CAP_MONTHS).toBe(legalValue("rentCommissionCapMonths"));
    // KDV artık tek yerde: üç tüketici aynı değeri okur.
    expect(DEFAULT_CAP_VAT_RATE).toBe(legalValue("vatGeneralPct"));
    expect(DEFAULT_VAT_RATE).toBe(legalValue("vatGeneralPct"));
  });

  it("tüketici dosyalar yasal sayıyı yeniden gömmez", () => {
    const pc = read("src/lib/purchase-costs.ts");
    expect(pc).not.toMatch(/deedFeeTotalPct:\s*4\b/);
    expect(pc).not.toMatch(/landRegistryServiceFeeTry:\s*6_?000/);
    expect(pc).not.toMatch(/export const MAX_LOAN_MONTHS = 120/);
    expect(read("src/lib/commission-cap.ts")).not.toMatch(/DEFAULT_CAP_VAT_RATE = 20/);
    expect(read("src/lib/commission.ts")).not.toMatch(/DEFAULT_VAT_RATE = 20/);
  });

  it("DKV dilimleri 2026 örnek tutarlarını verir", () => {
    expect(progressiveTax(17_711_000, DKV_BRACKETS)).toBe(0);
    expect(progressiveTax(26_567_000, DKV_BRACKETS)).toBe(26_568);
    expect(progressiveTax(35_425_000, DKV_BRACKETS)).toBe(79_716);
    expect(progressiveTax(45_425_000, DKV_BRACKETS)).toBe(179_716);
  });

  it("gelir vergisi kademeli hesaplanır; negatif/NaN 0", () => {
    expect(progressiveTax(100_000)).toBe(15_000);
    expect(progressiveTax(158_000)).toBe(23_700);
    expect(progressiveTax(330_000)).toBe(58_100);
    expect(progressiveTax(-5)).toBe(0);
    expect(progressiveTax(Number.NaN)).toBe(0);
  });
});
