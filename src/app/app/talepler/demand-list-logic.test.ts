import { describe, expect, it } from "vitest";
import {
  bandOf,
  budgetLabel,
  budgetOrFilter,
  demandAgeLabel,
  demandStatusTone,
  parseUrgencyParam,
  tallyPool,
  urgencyTone,
} from "./demand-list-logic";

describe("talep liste mantığı", () => {
  it("aciliyet paramı yalnız bilinen değerleri tutar", () => {
    expect(parseUrgencyParam("high, urgent,x")).toEqual(["high", "urgent"]);
    expect(parseUrgencyParam(undefined)).toEqual([]);
  });
  it("tonlar", () => {
    expect(demandStatusTone("matched")).toBe("success");
    expect(demandStatusTone("closed")).toBe("neutral");
    expect(urgencyTone("urgent")).toBe("danger");
    expect(urgencyTone("high")).toBe("warning");
    expect(urgencyTone(null)).toBe("neutral");
  });
  it("bütçe bandı üst sınıra göre, yoksa alt sınıra göre", () => {
    expect(bandOf({ budget_min: null, budget_max: 3_000_000 })).toBe("5m");
    expect(bandOf({ budget_min: 12_000_000, budget_max: null })).toBe("10m+");
    expect(bandOf({ budget_min: null, budget_max: null })).toBeNull();
    expect(bandOf({ budget_min: 0, budget_max: 0 })).toBe("2m");
  });
  it("bütçe or filtresi sunucuda kesilir (ilk bant gte, sonsuz üst sınır yok)", () => {
    expect(budgetOrFilter("2m")).toContain("budget_max.gte.0");
    expect(budgetOrFilter("5m")).toContain("budget_max.gt.2000000");
    expect(budgetOrFilter("10m+")).not.toContain("lte");
  });
  it("etiketler", () => {
    expect(budgetLabel(null, null)).toBe("Bütçe yok");
    expect(budgetLabel(null, 1_000_000)).toMatch(/^≤ 1\.000\.000/);
    expect(demandAgeLabel(0, "new")).toBe("Bugün açıldı");
    expect(demandAgeLabel(5, "active")).toBe("5 gündür açık");
    expect(demandAgeLabel(5, "closed")).toBe("5 gün önce açıldı");
  });
  it("havuz sayaçları kapalıları atar, illeri çoktan aza sıralar", () => {
    const rows = [
      { status: "new", budget_min: null, budget_max: 1_000_000, province_id: "a", provinceName: "İstanbul" },
      { status: "active", budget_min: null, budget_max: 1_500_000, province_id: "a", provinceName: "İstanbul" },
      { status: "active", budget_min: null, budget_max: 9_000_000, province_id: "b", provinceName: "Ankara" },
      { status: "closed", budget_min: null, budget_max: 1_000_000, province_id: "b", provinceName: "Ankara" },
    ];
    const t = tallyPool(rows);
    expect(t.bandCounts).toEqual({ "2m": 2, "10m": 1 });
    expect(t.provinces[0]).toMatchObject({ id: "a", count: 2 });
    expect(t.provinces[1]).toMatchObject({ id: "b", count: 1 });
  });
});
