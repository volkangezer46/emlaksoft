import { describe, expect, it } from "vitest";
import { expandForActuals, foldActuals, parseProgress, targetMembers } from "./target-progress";

const members = [
  { id: "a", team_id: "t1", branch_id: "b1" },
  { id: "b", team_id: "t1", branch_id: "b2" },
  { id: "c", team_id: null, branch_id: "b1" },
];
const base = { period: "monthly", period_start: "2026-10-01" };

describe("takım/şube hedefi gerçekleşmesi (OA4)", () => {
  it("kapsam üyeleri", () => {
    expect(targetMembers({ profile_id: "x", team_id: null, branch_id: null }, members)).toEqual(["x"]);
    expect(targetMembers({ profile_id: null, team_id: "t1", branch_id: null }, members)).toEqual(["a", "b"]);
    expect(targetMembers({ profile_id: null, team_id: null, branch_id: "b1" }, members)).toEqual(["a", "c"]);
    expect(targetMembers({ profile_id: null, team_id: null, branch_id: null }, members)).toBeNull();
  });

  it("açma + toplama: takım hedefi üyelerin toplamı; birinin geliri gizliyse toplam gizli", () => {
    const targets = [
      { id: "T", ...base, profile_id: null, team_id: "t1", branch_id: null },
      { id: "P", ...base, profile_id: "c", team_id: null, branch_id: null },
    ];
    const expanded = expandForActuals(targets, members);
    expect(expanded.map((e) => e.id)).toEqual(["T|a", "T|b", "P"]);
    const folded = foldActuals(
      targets,
      new Map([
        ["T|a", { deals: 2, revenue: 100, revenueVisible: true }],
        ["T|b", { deals: 1, revenue: 50, revenueVisible: false }],
        ["P", { deals: 4, revenue: 10, revenueVisible: true }],
      ]),
    );
    expect(folded.get("T")).toEqual({ deals: 3, revenue: 0, revenueVisible: false });
    expect(folded.get("P")).toEqual({ deals: 4, revenue: 10, revenueVisible: true });
  });

  it("RPC sonucu: eksik hedef satırı → null (sahte sıfır yok)", () => {
    const items = [{ id: "x", startIso: "", endIso: "", profileIds: null, appointments: true, listings: false, calls: true }];
    expect(parseProgress({ x: { appointments: 3, calls: 7 } }, items)?.get("x")).toEqual({ appointments: 3, listings: null, calls: 7 });
    expect(parseProgress({}, items)).toBeNull();
  });
});
