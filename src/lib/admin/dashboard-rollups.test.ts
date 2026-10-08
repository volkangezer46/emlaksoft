import { describe, expect, it } from "vitest";
import { monthlyUsageFromSums, parseDashboardRollups, trialConversionFromCounts } from "./dashboard-rollups";

describe("parseDashboardRollups", () => {
  it("geçersiz ham veri null döner (uydurma sıfır yok)", () => {
    expect(parseDashboardRollups(null)).toBeNull();
    expect(parseDashboardRollups([])).toBeNull();
    expect(parseDashboardRollups("x")).toBeNull();
  });

  it("RPC çıktısını tiplenmiş yapıya çevirir", () => {
    const r = parseDashboardRollups({
      activity: [{ tenant_id: "t1", events: 4, last_at: "2026-10-07T10:00:00Z" }, { tenant_id: null, events: 9, last_at: "" }],
      activity_days: [{ day: "2026-10-07", events: 4, tenants: 1 }],
      funnel: { registered: 10, with_property: 6, with_deal: 2 },
      trial: { ended: 8, converted: 2 },
      cancel_reasons: [{ reason: "Pahalı", count: 3 }],
      ledger_months: [{ unit: "ai", month: "2026-10", total: "12.5" }],
    });
    expect(r?.activity).toEqual([{ officeId: "t1", events: 4, lastAt: "2026-10-07T10:00:00Z" }]);
    expect(r?.activityDays[0]).toEqual({ day: "2026-10-07", events: 4, tenants: 1 });
    expect(r?.funnel).toEqual({ registered: 10, withProperty: 6, withDeal: 2 });
    expect(r?.trial).toEqual({ ended: 8, converted: 2, rate: 25 });
    expect(r?.cancelReasons).toEqual([{ reason: "Pahalı", count: 3 }]);
    expect(r?.ledgerMonths[0]?.total).toBe(12.5);
  });

  it("eksik parçalar null/boş kalır", () => {
    const r = parseDashboardRollups({});
    expect(r?.funnel).toBeNull();
    expect(r?.trial).toBeNull();
    expect(r?.activity).toEqual([]);
  });
});

describe("trialConversionFromCounts", () => {
  it("payda 0 ise oran null", () => {
    expect(trialConversionFromCounts(0, 0)).toEqual({ ended: 0, converted: 0, rate: null });
    expect(trialConversionFromCounts(3, 1).rate).toBe(33);
  });
});

describe("monthlyUsageFromSums", () => {
  it("son 6 TR ayına birim bazlı yerleştirir; pencere dışı ve bilinmeyen birimi atlar", () => {
    const now = Date.parse("2026-10-08T09:00:00Z");
    const u = monthlyUsageFromSums(
      [
        { unit: "ai", month: "2026-10", total: 10 },
        { unit: "ai", month: "2026-05", total: 4 },
        { unit: "ef", month: "2026-09", total: 2.5 },
        { unit: "ai", month: "2025-01", total: 99 },
        { unit: "diger", month: "2026-10", total: 7 },
      ],
      ["ai", "valuation", "ef"],
      now,
    );
    expect(u.months).toHaveLength(6);
    expect(u.months[5]?.key).toBe("2026-10");
    expect(u.byUnit.ai?.[5]).toBe(10);
    expect(u.byUnit.ai?.[0]).toBe(4);
    expect(u.byUnit.ef?.[4]).toBe(2.5);
    expect(u.total).toBe(16.5);
  });
});
