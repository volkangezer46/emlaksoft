import { describe, expect, it } from "vitest";
import { distributeInt, distributeMoney, normalizePeriodStart, planCopy, previousPeriodStart, scopeColumns, scopeKeyOf } from "./target-scope";

describe("hedef kapsamı (OA4)", () => {
  it("dönem başlangıcı ve önceki dönem", () => {
    expect(normalizePeriodStart("2026-10")).toBe("2026-10-01");
    expect(normalizePeriodStart("2026-13")).toBeNull();
    expect(previousPeriodStart("monthly", "2026-01-01")).toBe("2025-12-01");
    expect(previousPeriodStart("quarterly", "2026-01-01")).toBe("2025-10-01");
    expect(previousPeriodStart("yearly", "2026-01-01")).toBe("2025-01-01");
  });

  it("kapsam kolonlarından yalnız biri dolu", () => {
    expect(scopeColumns({ kind: "takim", teamId: "t1" })).toEqual({ profile_id: null, team_id: "t1", branch_id: null });
    expect(scopeColumns({ kind: "ofis" })).toEqual({ profile_id: null, team_id: null, branch_id: null });
    expect(scopeKeyOf({ branch_id: "b1" })).toBe("b:b1");
    expect(scopeKeyOf({})).toBe("o");
  });

  it("eşit dağıtım toplamı korur", () => {
    expect(distributeInt(10, 3)).toEqual([4, 3, 3]);
    expect(distributeInt(2, 3)).toEqual([1, 1, 0]);
    const money = distributeMoney(100_000, 3);
    expect(money.reduce((a, b) => a + b, 0)).toBeCloseTo(100_000, 2);
    expect(money[1]).toBe(33_333.33);
    expect(distributeInt(5, 0)).toEqual([]);
  });

  it("kopya planı aynı kapsamı atlar (idempotent)", () => {
    const prev = [{ profile_id: "a" }, { profile_id: "b" }, { team_id: "t" }, {}];
    const { copy, skipped } = planCopy(prev, [{ profile_id: "a" }, {}]);
    expect(copy.map(scopeKeyOf)).toEqual(["p:b", "t:t"]);
    expect(skipped).toBe(2);
  });
});
