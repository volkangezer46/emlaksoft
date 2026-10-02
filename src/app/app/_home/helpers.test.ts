import { describe, expect, it } from "vitest";
import {
  calcTrend,
  chartGeometry,
  commissionTotals,
  greetingFor,
  initials,
  lastSixMonthKeys,
  monthTotalsFor,
  pipelineStats,
  teamLeaders,
  weekBuckets,
} from "./helpers";

const DAY = 86_400_000;

describe("calcTrend", () => {
  it("önceki dönem 0 ise yeni/%0 döner", () => {
    expect(calcTrend(3, 0)).toEqual({ label: "yeni", dir: "new" });
    expect(calcTrend(0, 0)).toEqual({ label: "%0", dir: "flat" });
  });
  it("artışı ve invert ile iyi/kötü rengini ayırır", () => {
    expect(calcTrend(12, 10)).toMatchObject({ label: "%+20", dir: "up", good: true });
    expect(calcTrend(12, 10, true)).toMatchObject({ dir: "up", good: false });
    expect(calcTrend(8, 10)).toMatchObject({ label: "%-20", dir: "down", good: false });
  });
});

describe("greetingFor", () => {
  it("saate göre tek selamlama seçer", () => {
    expect(greetingFor(8)).toBe("Günaydın");
    expect(greetingFor(14)).toBe("İyi günler");
    expect(greetingFor(19)).toBe("İyi akşamlar");
    expect(greetingFor(2)).toBe("İyi geceler");
  });
});

describe("weekBuckets", () => {
  it("tarihleri haftalık kovalara dağıtır, pencere dışını atar", () => {
    const now = Date.UTC(2026, 5, 15);
    const dates = [new Date(now - 1 * DAY).toISOString(), new Date(now - 8 * DAY).toISOString(), new Date(now - 100 * DAY).toISOString()];
    const b = weekBuckets(dates, now);
    expect(b).toHaveLength(7);
    expect(b[6]).toBe(1);
    expect(b[5]).toBe(1);
    expect(b.reduce((s, x) => s + x, 0)).toBe(2);
  });
});

describe("komisyon serisi", () => {
  it("ödenen/bekleyen toplamı ayırır", () => {
    const rows = [
      { gross_amount: 100, status: "paid", created_at: "2026-06-01T00:00:00Z" },
      { gross_amount: "50", status: "collected", created_at: "2026-06-02T00:00:00Z" },
      { gross_amount: 30, status: "pending", created_at: "2026-05-02T00:00:00Z" },
    ];
    expect(commissionTotals(rows)).toEqual({ paid: 150, pending: 30 });
  });
  it("6 ay anahtarı üretir ve aylık toplar", () => {
    const now = Date.UTC(2026, 6, 31, 12);
    const keys = lastSixMonthKeys(now);
    expect(keys).toHaveLength(6);
    expect(keys[5]).toBe("2026-07");
    expect(keys[0]).toBe("2026-02");
    const totals = monthTotalsFor(
      [
        { gross_amount: 10, status: "paid", created_at: "2026-07-03T00:00:00Z" },
        { gross_amount: 5, status: "paid", created_at: "2026-07-20T00:00:00Z" },
        { gross_amount: 99, status: "paid", created_at: "2025-01-01T00:00:00Z" },
      ],
      keys,
    );
    expect(totals[5]).toBe(15);
    expect(totals.reduce((s, x) => s + x, 0)).toBe(15);
  });
  it("grafik geometrisi boş seride çökmez", () => {
    const g = chartGeometry([0, 0, 0, 0, 0, 0]);
    expect(g.pts).toHaveLength(6);
    expect(g.last?.x).toBe(700);
  });
});

describe("pipeline ve ekip", () => {
  const deals = [
    { stage: "won", deal_value: 100, assigned_to: "a", updated_at: null },
    { stage: "new", deal_value: 50, assigned_to: "a", updated_at: null },
    { stage: "lost", deal_value: 10, assigned_to: "b", updated_at: null },
  ];
  it("kazanma oranı ve açık anlaşma", () => {
    expect(pipelineStats({ new: 1, active: 1, matched: 0 }, deals)).toEqual({ dealWon: 1, openDeals: 1, conversion: 33.3 });
    expect(pipelineStats({ new: 0, active: 0, matched: 0 }, []).conversion).toBe(0);
  });
  it("danışmanları değere göre sıralar", () => {
    const t = teamLeaders(deals, [{ id: "a", full_name: "Ayşe Yılmaz", role: "owner" }]);
    expect(t[0]).toMatchObject({ id: "a", value: 150, initials: "AY" });
    expect(t[1]).toMatchObject({ id: "b", name: "Danışman" });
    expect(initials("ali veli")).toBe("AV");
  });
});
