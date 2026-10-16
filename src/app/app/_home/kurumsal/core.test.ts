import { describe, expect, it } from "vitest";
import { deltaOf, salesSeries, salesSummary, type SalesRow } from "./core";

// 16 Ekim 2026 12:00 TR (09:00 UTC)
const NOW = Date.UTC(2026, 9, 16, 9);
const at = (m: number, d: number) => new Date(Date.UTC(2026, m, d, 9)).toISOString();

describe("satış performansı serisi", () => {
  const rows: SalesRow[] = [
    { value: 3_000_000, createdAt: at(9, 7), closedAt: at(9, 7) },
    { value: 3_455_000, createdAt: at(9, 7), closedAt: at(9, 7) },
    { value: 1_000_000, createdAt: at(8, 1), closedAt: at(8, 20) },
  ];
  it("'Bu ay' haftalık kova toplamı — birikimli merdiven değil", () => {
    const s = salesSeries(rows, "ay", NOW);
    expect(s.map((x) => x.label)).toEqual(["1–7 Eki", "8–14 Eki", "15–16 Eki"]);
    expect(s.map((x) => x.value)).toEqual([6_455_000, 0, 0]);
  });
  it("'Son 6 ay' aylık kova", () => {
    const s = salesSeries(rows, "6ay", NOW);
    expect(s).toHaveLength(6);
    expect(s.at(-1)).toEqual({ label: "Eki", value: 6_455_000 });
    expect(s.at(-2)).toEqual({ label: "Eyl", value: 1_000_000 });
  });
  it("aynı gün açılıp kapanan satışlar '0 gün' üretmez: süre yok + açıklama", () => {
    const s = salesSummary(rows, "ay", NOW);
    expect(s.avgDays).toBeNull();
    expect(s.avgNote).toBeTruthy();
    expect(s.avgDelta).toBeNull();
  });
});

describe("deltaOf", () => {
  it("tek kural: önceki 0 → yeni; çok küçük taban → yeni; asla %6300", () => {
    expect(deltaOf(64, 0)!.text).toBe("yeni");
    expect(deltaOf(64, 1)!.text).toBe("yeni");
    expect(deltaOf(261_500, 146_000)!.text).toBe("%79");
  });
});
