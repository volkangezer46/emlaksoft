import { describe, expect, it } from "vitest";
import { salesSeries, salesSummary, type SalesRange, type SalesRow } from "./core";
import { aggregateSalesRows, parseKpiSnapshot, parseSalesWindows, salesFromWindowAggs, salesRpcWindows } from "./kpi-snapshot";

const NOW = Date.parse("2026-10-17T13:20:00Z");
const e = (total: number, extra: Record<string, unknown> = {}) => ({ total, this_month: 2, prev_month: 1, weekly: [0, 1, 2], ...extra });

describe("home_kpi_snapshot ayrıştırıcı", () => {
  it("geçerli biçim → görüntü; eksik/yanlış alan → null (eski yola düşülür)", () => {
    const ok = { version: 1, sample_included: true, customers: e(33), deals: e(5, { open: 3 }), demands: e(4), calls: e(9) };
    expect(parseKpiSnapshot(ok, 3)?.customers).toEqual({ total: 33, thisMonth: 2, prevMonth: 1, weekly: [0, 1, 2] });
    expect(parseKpiSnapshot(ok, 3)?.deals.open).toBe(3);
    expect(parseKpiSnapshot({ ...ok, version: 2 }, 3)).toBeNull();
    expect(parseKpiSnapshot({ ...ok, deals: e(5) }, 3)).toBeNull();
    expect(parseKpiSnapshot(ok, 12)).toBeNull();
    expect(parseKpiSnapshot(null, 3)).toBeNull();
  });
});

describe("satış pencere toplamı ↔ salesSummary/salesSeries paritesi", () => {
  const rows: SalesRow[] = [
    { value: 4_500_000, createdAt: "2026-09-01T09:00:00Z", closedAt: "2026-10-02T10:00:00Z" },
    { value: 3_200_000, createdAt: "2026-10-10T09:00:00Z", closedAt: "2026-10-10T15:00:00Z" },
    { value: 1_000_000, createdAt: null, closedAt: "2026-10-16T08:00:00Z" },
    { value: 2_750_000, createdAt: "2026-08-01T09:00:00Z", closedAt: "2026-09-12T10:00:00Z" },
    { value: 9_000_000, createdAt: "2026-03-01T09:00:00Z", closedAt: "2026-05-20T10:00:00Z" },
    { value: 6_100_000, createdAt: "2025-11-01T09:00:00Z", closedAt: "2025-12-20T10:00:00Z" },
  ];
  for (const range of ["ay", "6ay", "yil"] as SalesRange[]) {
    it(range, () => {
      const { windows, labels } = salesRpcWindows(range, NOW);
      const out = salesFromWindowAggs(aggregateSalesRows(rows, windows), labels)!;
      expect(out.summary).toEqual(salesSummary(rows, range, NOW));
      expect(out.series).toEqual(salesSeries(rows, range, NOW));
    });
  }
  it("pencere sayısı uyuşmazsa null", () => {
    expect(parseSalesWindows({ version: 1, windows: [] }, 2)).toBeNull();
    expect(parseSalesWindows({ version: 1, windows: [{ sum: "10", count: 1, dur_days: 0, dur_n: 0 }] }, 1)).toEqual([{ sum: 10, count: 1, durDays: 0, durN: 0 }]);
  });
});
