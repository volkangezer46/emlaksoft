import { describe, expect, it } from "vitest";
import {
  attentionReasons,
  buildTimeline,
  compareMonths,
  countInRange,
  monthRanges,
  openPipeline,
  untrackedCustomerIds,
} from "./advisor-360";

describe("advisor-360", () => {
  it("ay sınırları TR takvimine göre", () => {
    const r = monthRanges(Date.parse("2026-10-03T12:00:00Z"));
    expect(r.thisStartIso).toBe("2026-09-30T21:00:00.000Z");
    expect(r.prevStartIso).toBe("2026-08-31T21:00:00.000Z");
    expect(r.nextStartIso).toBe("2026-10-31T21:00:00.000Z");
  });
  it("şubat ve 31 çeken aylarda sonraki ay başı doğru", () => {
    expect(monthRanges(Date.parse("2026-02-10T12:00:00Z")).nextStartIso).toBe("2026-02-28T21:00:00.000Z");
    expect(monthRanges(Date.parse("2026-01-10T12:00:00Z")).nextStartIso).toBe("2026-01-31T21:00:00.000Z");
    expect(monthRanges(Date.parse("2026-12-10T12:00:00Z")).nextStartIso).toBe("2026-12-31T21:00:00.000Z");
  });
  it("önceki ay 0 ise yüzde yok", () => {
    expect(compareMonths(5, 0)).toEqual({ diff: 5, pct: null, dir: "up" });
    expect(compareMonths(3, 4)).toEqual({ diff: -1, pct: -25, dir: "down" });
    expect(compareMonths(2, 2).dir).toBe("flat");
  });
  it("aralık sayımı yarı açık", () => {
    const rows = [{ at: "2026-10-01T00:00:00Z" }, { at: "2026-11-01T00:00:00Z" }, { at: "2026-09-01T00:00:00Z" }];
    expect(countInRange(rows, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toBe(1);
  });
  it("zaman çizelgesi sıralı, sınırlı, geçersiz tarih atılır", () => {
    const ev = (key: string, at: string) => ({ key, kind: "call" as const, title: key, sub: null, at, href: "/" });
    const out = buildTimeline([ev("a", "2026-01-01T00:00:00Z"), ev("b", "2026-03-01T00:00:00Z"), ev("c", "bozuk"), ev("d", "2026-02-01T00:00:00Z")], 2);
    expect(out.map((e) => e.key)).toEqual(["b", "d"]);
  });
  it("açık pipeline won/lost hariç", () => {
    const p = openPipeline([
      { stage: "new", deal_value: 100 },
      { stage: "new", deal_value: "50" },
      { stage: "won", deal_value: 999 },
      { stage: "negotiation", deal_value: null },
    ]);
    expect(p).toEqual([
      { stage: "new", count: 2, value: 150 },
      { stage: "qualified", count: 0, value: 0 },
      { stage: "negotiation", count: 1, value: 0 },
    ]);
  });
  it("takipsiz müşteriler tekilleşir", () => {
    expect(untrackedCustomerIds(["a", "a", "b", null, "c"], ["b", null])).toEqual(["a", "c"]);
  });
  it("dikkat nedenleri eşik ve null", () => {
    expect(attentionReasons({ overdueTasks: 3, untrackedDemands: 2 })).toEqual(["3 gecikmiş görev"]);
    expect(attentionReasons({ overdueTasks: null, untrackedDemands: null })).toEqual([]);
    expect(attentionReasons({ overdueTasks: 5, untrackedDemands: 4 })).toHaveLength(2);
  });
});
