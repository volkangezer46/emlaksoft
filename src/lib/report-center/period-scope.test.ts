import { describe, expect, it } from "vitest";
import {
  changePct,
  daysBetweenInclusive,
  periodScopeParams,
  resolveReportPeriod,
  resolveReportScope,
} from "./period-scope";

const TODAY = "2026-10-15";

describe("resolveReportPeriod", () => {
  it("varsayılan bu ay: ayın 1'i → bugün; önceki dönem aynı uzunlukta hemen önce", () => {
    const p = resolveReportPeriod({}, TODAY);
    expect(p).toMatchObject({ key: "bu-ay", from: "2026-10-01", to: TODAY, days: 15, prevFrom: "2026-09-16", prevTo: "2026-09-30" });
  });

  it("geçen ay ve çeyrekler takvim sınırına oturur (yıl dönümü dahil)", () => {
    expect(resolveReportPeriod({ donem: "gecen-ay" }, TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveReportPeriod({ donem: "bu-ceyrek" }, TODAY)).toMatchObject({ from: "2026-10-01", to: TODAY });
    expect(resolveReportPeriod({ donem: "gecen-ceyrek" }, TODAY)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(resolveReportPeriod({ donem: "gecen-ay" }, "2026-01-10")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveReportPeriod({ donem: "gecen-ceyrek" }, "2026-02-10")).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
    expect(resolveReportPeriod({ donem: "bu-yil" }, TODAY)).toMatchObject({ from: "2026-01-01", to: TODAY });
    expect(resolveReportPeriod({ donem: "son-90" }, TODAY).days).toBe(90);
  });

  it("özel aralık: ters uçlar düzelir, gelecek kırpılır, geçersiz değer varsayılana düşer", () => {
    expect(resolveReportPeriod({ donem: "ozel", baslangic: "2026-09-30", bitis: "2026-09-01" }, TODAY)).toMatchObject({
      key: "ozel",
      from: "2026-09-01",
      to: "2026-09-30",
      label: "1.09.2026 – 30.09.2026",
    });
    expect(resolveReportPeriod({ donem: "ozel", baslangic: "2026-10-01", bitis: "2027-01-01" }, TODAY).to).toBe(TODAY);
    expect(resolveReportPeriod({ donem: "ozel", baslangic: "2026-02-30" }, TODAY).key).toBe("bu-ay");
    expect(resolveReportPeriod({ donem: "xx" }, TODAY).key).toBe("bu-ay");
  });

  it("özel aralık en fazla 1095 gün", () => {
    const p = resolveReportPeriod({ donem: "ozel", baslangic: "2010-01-01", bitis: TODAY }, TODAY);
    expect(daysBetweenInclusive(p.from, p.to)).toBe(1095);
  });
});

describe("kapsam + URL", () => {
  it("yalnız geçerli uuid kabul edilir", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(resolveReportScope({ sube: id, takim: "x", danisman: "" })).toEqual({ branchId: id, teamId: null, profileId: null });
  });

  it("varsayılan dönem URL'e yazılmaz; özel aralık uçlarıyla yazılır", () => {
    const scope = { branchId: null, teamId: null, profileId: null };
    expect(periodScopeParams(resolveReportPeriod({}, TODAY), scope)).toEqual({});
    expect(periodScopeParams(resolveReportPeriod({ donem: "ozel", baslangic: "2026-09-01", bitis: "2026-09-10" }, TODAY), scope)).toEqual({
      donem: "ozel",
      baslangic: "2026-09-01",
      bitis: "2026-09-10",
    });
  });

  it("changePct: önceki 0 iken artış 'yeni' (null), ikisi 0 ise 0", () => {
    expect(changePct(15, 10)).toBe(50);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(0, 0)).toBe(0);
  });
});
