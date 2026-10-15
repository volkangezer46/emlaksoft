import { describe, expect, it } from "vitest";
import { addMonths, cohortHeat, firstCoveredMonth, monthDiff, mrrMovements, revenueRetention, signupCohorts, type MonthEndRow } from "./mrr-movements";

const r = (tenant_id: string, month: string, mrr: number): MonthEndRow => ({ tenant_id, month, mrr });

describe("ay aritmetiği", () => {
  it("yıl sınırını geçer", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthDiff("2025-12", "2026-02")).toBe(2);
  });
});

describe("mrrMovements", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const rows: MonthEndRow[] = [
    // a: 100 → 150 (genişleme) → 0 (kayıp) → 120 (geri dönen)
    r("a", "2026-07", 100),
    r("a", "2026-08", 150),
    r("a", "2026-09", 0),
    r("a", "2026-10", 120),
    // b: 200 → 120 (daralma) → 120 → 120
    r("b", "2026-07", 200),
    r("b", "2026-08", 120),
    r("b", "2026-09", 120),
    r("b", "2026-10", 120),
    // c: deneme (0) → 300 (yeni)
    r("c", "2026-07", 0),
    r("c", "2026-08", 300),
    r("c", "2026-09", 300),
    r("c", "2026-10", 300),
  ];

  it("ofis bazında net değişimi beş sınıfa ayırır; ilk ay yalnız tabandır", () => {
    const m = mrrMovements(rows, months);
    expect(m).toHaveLength(3);
    const aug = m[0]!;
    expect(aug.month).toBe("2026-08");
    expect(aug.covered).toBe(true);
    expect(aug.amounts).toEqual({ new: 300, expansion: 50, contraction: 80, churn: 0, reactivation: 0 });
    expect(aug.net).toBe(270);
    expect(aug.startMrr).toBe(300);
    expect(aug.endMrr).toBe(570);
    expect(m[1]!.amounts.churn).toBe(150);
    expect(m[1]!.counts.churn).toBe(1);
    // a daha önce ödediği için "yeni" değil "geri dönen".
    expect(m[2]!.amounts.reactivation).toBe(120);
    expect(m[2]!.amounts.new).toBe(0);
  });

  it("anlık görüntüsü olmayan ay hareket üretmez (uydurma yok)", () => {
    const m = mrrMovements(rows.filter((x) => x.month !== "2026-09"), months);
    expect(m[1]!.covered).toBe(false);
    expect(m[1]!.net).toBe(0);
    expect(m[2]!.covered).toBe(false);
  });

  it("dışlanan (iç/demo) ofis hesaba girmez", () => {
    const m = mrrMovements(rows, months, new Set(["c"]));
    expect(m[0]!.amounts.new).toBe(0);
  });
});

describe("revenueRetention", () => {
  const rows = [r("a", "2026-08", 100), r("b", "2026-08", 100), r("a", "2026-09", 150), r("b", "2026-09", 50), r("n", "2026-09", 999)];
  it("NRR genişlemeyi sayar, GRR saymaz; yeni ofis kümeye girmez", () => {
    const x = revenueRetention(rows, "2026-08", "2026-09")!;
    expect(x.startMrr).toBe(200);
    expect(x.startTenants).toBe(2);
    expect(x.nrr).toBe(100);
    expect(x.grr).toBe(75);
  });
  it("kapsanmayan ay ya da sıfır taban null döner", () => {
    expect(revenueRetention(rows, "2026-07", "2026-09")).toBeNull();
    expect(revenueRetention([r("a", "2026-08", 0), r("a", "2026-09", 10)], "2026-08", "2026-09")).toBeNull();
  });
});

describe("signupCohorts", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const rows = [r("a", "2026-08", 0), r("b", "2026-08", 0), r("a", "2026-09", 100), r("b", "2026-09", 0), r("a", "2026-10", 100), r("b", "2026-10", 50), r("c", "2026-10", 0)];
  const signups = [
    { id: "a", month: "2026-08" },
    { id: "b", month: "2026-08" },
    { id: "c", month: "2026-10" },
    { id: "old", month: "2025-01" },
  ];
  it("satır = kayıt ayı (yeniden eskiye), hücre = ödeyen oranı; gelecek ay boş", () => {
    const g = signupCohorts(rows, signups, months, { maxOffset: 3 });
    expect(g.map((x) => x.cohort)).toEqual(["2026-10", "2026-08"]);
    const aug = g[1]!;
    expect(aug.size).toBe(2);
    expect(aug.cells.map((c) => c?.pct ?? null)).toEqual([0, 50, 100, null]);
    expect(aug.cells[2]!.mrr).toBe(150);
    expect(g[0]!.cells[1]).toBeNull();
  });
  it("ilk kapsanmış ay ve ısı tonu", () => {
    expect(firstCoveredMonth(rows, ["2026-07", ...months])).toBe("2026-08");
    expect(cohortHeat(85)).toBe(4);
    expect(cohortHeat(5)).toBe(0);
  });
});
