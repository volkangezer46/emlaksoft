import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_SERIES_LIMIT,
  parseInsightsSnapshot,
  parseMetricsSnapshot,
  parseTasksSnapshot,
  periodSeries,
  periodStatsFromSnapshot,
} from "./snapshot-core";

const scope = (n: number) => ({ due_today: n, overdue: n + 1, open: [{ id: "t1", title: "Ara", due_at: "2026-10-06T08:00:00Z", priority: "high" }, { id: 5 }] });

describe("parseTasksSnapshot", () => {
  it("ben/ofis kapsamlarını ve açık görevleri tipler; kimliksiz satır atılır", () => {
    const s = parseTasksSnapshot({ sample_included: true, mine: scope(1), office: scope(3) });
    expect(s).not.toBeNull();
    expect(s!.sampleIncluded).toBe(true);
    expect(s!.mine).toEqual({ dueToday: 1, overdue: 2, open: [{ id: "t1", title: "Ara", due_at: "2026-10-06T08:00:00Z", priority: "high" }] });
    expect(s!.office.dueToday).toBe(3);
  });
  it("örnek veri kararı yoksa ya da kapsam eksikse null", () => {
    expect(parseTasksSnapshot({ mine: scope(1), office: scope(1) })).toBeNull();
    expect(parseTasksSnapshot({ sample_included: false, mine: scope(1) })).toBeNull();
    expect(parseTasksSnapshot(null)).toBeNull();
  });
});

const metricsRaw = {
  sample_included: false,
  kpi: { customer_count: "12", property_count: 4, calls_today: 1, calls_yesterday: 2, customers_this_month: 3, customers_prev_month: 1, call_dates: ["2026-10-06T07:00:00Z"], customer_dates: [] },
  demands: { new: 2, active: 5, matched: 1 },
  period: {
    p7: { customers: 1, customers_prev: 0, demands: 2, demands_prev: 1 },
    p30: { customers: 3, customers_prev: 2, demands: 4, demands_prev: 4 },
    p90: { customers: 9, customers_prev: 7, demands: 10, demands_prev: 8 },
    customer_dates_90: ["2026-10-05T10:00:00Z", "2026-09-20T10:00:00Z", "2026-08-01T10:00:00Z"],
    demand_dates_90: [],
  },
  decisions: { approvals_pending: 2, lost_this_month: "1500.50", overdue_rent: 1, passive_days: 30, passive_advisors: 0 },
  expiring_authority: { mine: [{ id: "p1", property_code: "A-1", title: "Daire", authorization_end: "2026-10-10" }], office: [{ id: "bad" }] },
};

describe("parseMetricsSnapshot", () => {
  it("KPI, talep, dönem, karar ve yetki alanlarını tipler", () => {
    const m = parseMetricsSnapshot(metricsRaw);
    expect(m).not.toBeNull();
    expect(m!.kpi.customerCount).toBe(12);
    expect(m!.demands).toEqual({ new: 2, active: 5, matched: 1 });
    expect(m!.period.p30.demandsPrev).toBe(4);
    expect(m!.decisions.lostThisMonth).toBeCloseTo(1500.5);
    expect(m!.expiringAuthority.mine).toEqual([{ id: "p1", property_code: "A-1", title: "Daire", authority_expires_at: "2026-10-10" }]);
    expect(m!.expiringAuthority.office).toEqual([]);
  });
  it("dönem bloğu eksikse null (sahte sıfır yok)", () => {
    expect(parseMetricsSnapshot({ ...metricsRaw, period: { p7: {}, p30: {} } })).toBeNull();
    expect(parseMetricsSnapshot({ ...metricsRaw, sample_included: "yes" })).toBeNull();
  });
});

describe("periodSeries / periodStatsFromSnapshot", () => {
  it("tavana çarpmayan 90 günlük seriden alt dönem süzülür", () => {
    const m = parseMetricsSnapshot(metricsRaw)!;
    const p30 = periodStatsFromSnapshot(m, 30, "2026-09-06T00:00:00Z");
    expect(p30.customers).toBe(3);
    expect(p30.customerDates).toEqual(["2026-10-05T10:00:00Z", "2026-09-20T10:00:00Z"]);
    expect(p30.demandDates).toEqual([]);
    const p90 = periodStatsFromSnapshot(m, 90, "2026-07-08T00:00:00Z");
    expect(p90.customerDates).toHaveLength(3);
  });
  it("tavana çarpan seri: en eski tarih dönem başından önceyse alt seri tam, değilse null", () => {
    const start = "2026-09-29T00:00:00Z";
    const capped = Array.from({ length: SNAPSHOT_SERIES_LIMIT }, (_, i) => (i === 0 ? "2026-09-01T00:00:00Z" : "2026-10-01T00:00:00Z"));
    expect(periodSeries(capped, start)).toHaveLength(SNAPSHOT_SERIES_LIMIT - 1);
    const allRecent = Array.from({ length: SNAPSHOT_SERIES_LIMIT }, () => "2026-10-01T00:00:00Z");
    expect(periodSeries(allRecent, start)).toBeNull();
    expect(periodSeries(allRecent, "2026-07-08T00:00:00Z")).toBeNull();
  });
});

describe("parseInsightsSnapshot", () => {
  it("satırları ve durum sayaçlarını tipler; zorunlu alanı eksik satır atılır", () => {
    const s = parseInsightsSnapshot({
      rows: [
        { id: "i1", title: "Ara", href: "/app/musteriler/1", valid_until: "2026-10-07T00:00:00Z", created_at: "2026-10-06T00:00:00Z", state: "new", priority: 50 },
        { id: "i2", title: "Eksik" },
      ],
      counts: { new: 1, seen: "2" },
    });
    expect(s).not.toBeNull();
    expect(s!.rows.map((r) => r.id)).toEqual(["i1"]);
    expect(s!.counts).toEqual({ new: 1, seen: 2, snoozed: 0, dismissed: 0, accepted: 0 });
  });
  it("şekil bozuksa null", () => {
    expect(parseInsightsSnapshot({ rows: "x", counts: {} })).toBeNull();
    expect(parseInsightsSnapshot(undefined)).toBeNull();
  });
});
