import { describe, expect, it } from "vitest";
import { computeRecoveryReport, monthlyEquivalent, parseRecoveryList, type ReportInvoice } from "./dunning-report";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 12);
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const inv = (id: string, o: Partial<ReportInvoice>): ReportInvoice => ({
  id,
  tenant_id: `t-${id}`,
  invoice_no: `F-${id}`,
  status: "open",
  total_try: 1000,
  due_at: iso(20),
  paid_at: null,
  ...o,
});

describe("tahsilat kurtarma raporu", () => {
  const invoices = [
    inv("ontime", { status: "paid", due_at: iso(30), paid_at: iso(31) }), // vadesinde ödendi: sayılmaz
    inv("late", { status: "paid", due_at: iso(30), paid_at: iso(20), total_try: 1200 }), // kurtarıldı
    inv("lateYearly", { status: "paid", due_at: iso(50), paid_at: iso(40), total_try: 12_000, period_start: iso(50), period_end: new Date(NOW + 315 * DAY).toISOString() }),
    inv("oldDueLatePaid", { status: "paid", due_at: iso(120), paid_at: iso(10), total_try: 500 }), // vade pencere dışı, ödeme içinde → kurtarılan
    inv("oldPaid", { status: "paid", due_at: iso(200), paid_at: iso(150), total_try: 999 }), // ödeme pencere dışı
    inv("open3", { due_at: iso(3) }), // başarısız, kayıp eşiği altında
    inv("open20", { due_at: iso(20) }), // başarısız + kayıp
    inv("uncol", { status: "uncollectible", due_at: iso(40) }), // başarısız + kayıp
    inv("void", { status: "void", due_at: iso(10) }),
    inv("future", { due_at: new Date(NOW + 5 * DAY).toISOString() }),
  ];
  const r = computeRecoveryReport({ invoices, payingTenants: 20, lossThresholdDays: 8, nowMs: NOW });

  it("kurtarılan tutar fatura toplamıyla birebir (son 90 gün, vadeden sonra ödenen)", () => {
    expect(r.recovered.map((i) => i.id).sort()).toEqual(["late", "lateYearly", "oldDueLatePaid"]);
    expect(r.recoveredAmount).toBe(1200 + 12_000 + 500);
    // Yıllık fatura aylık karşılığa çevrilir.
    expect(r.recoveredMrr).toBe(1200 + 1000 + 500);
  });

  it("başarısız tahsilat ve istemsiz kayıp", () => {
    expect(r.failed.map((i) => i.id).sort()).toEqual(["late", "lateYearly", "open20", "open3", "uncol"]);
    expect(r.lost.map((i) => i.id).sort()).toEqual(["open20", "uncol"]);
    expect(r.lostTenants).toBe(2);
    expect(r.involuntaryChurnRate).toBeCloseTo(0.1);
    expect(r.recoveryRate).toBeCloseTo(2 / 5);
  });

  it("payda yoksa oran yok; liste parametresi güvenli", () => {
    expect(computeRecoveryReport({ invoices: [], payingTenants: 0, lossThresholdDays: 8, nowMs: NOW }).involuntaryChurnRate).toBeNull();
    expect(parseRecoveryList("kayip")).toBe("kayip");
    expect(parseRecoveryList("x")).toBe("basarisiz");
    expect(monthlyEquivalent({ total_try: 300, period_start: null, period_end: null })).toBe(300);
  });
});
