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
