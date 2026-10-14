import { describe, expect, it } from "vitest";
import { computeHealth, healthBand, healthBandRange, normalizeWeights, paymentComponent, supportComponent, usageComponent, type HealthInputs } from "./health-score";
import { derivedStage, derivedStatusCondition, effectiveStage, sanitizeViewParams, stageFilterOr, viewHref } from "./platform-crm";

const healthy: HealthInputs = {
  status: "active",
  subStatus: "active",
  loginDays: 20,
  activeUsers: 5,
  seatLimit: 5,
  moduleAreas: 8,
  openTickets: 0,
  csatAvg: null,
  csatN: 0,
  overdueInvoices: 0,
  maxOverdueDays: 0,
};

describe("ofis sağlık skoru (saf)", () => {
  it("tam sağlıklı ofis 100; sınırlar 0..100", () => {
    const h = computeHealth(healthy);
    expect(h.score).toBe(100);
    expect(h.reasons).toEqual([]);
    const worst = computeHealth({ ...healthy, status: "suspended", loginDays: 0, activeUsers: 0, moduleAreas: 0, openTickets: 9, csatAvg: 1, csatN: 2 });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(15);
    expect(worst.reasons.length).toBeLessThanOrEqual(3);
  });

  it("varsayılan ağırlıklar kullanım %50, ödeme %30, destek %20", () => {
    // Kullanım 0, ödeme 1, destek 1 → 50
    expect(computeHealth({ ...healthy, loginDays: 0, activeUsers: 0, moduleAreas: 0 }).score).toBe(50);
    // Askıda: ödeme 0 → 70
    expect(computeHealth({ ...healthy, status: "suspended" }).score).toBe(70);
  });

  it("ağırlık değişikliği skoru değiştirir; toplam 0 ise varsayılana döner", () => {
    const inp = { ...healthy, loginDays: 0, activeUsers: 0, moduleAreas: 0 };
    expect(computeHealth(inp, { usage: 100, payment: 0, support: 0 }).score).toBe(0);
    expect(computeHealth(inp, { usage: 0, payment: 0, support: 0 }).score).toBe(50);
    expect(normalizeWeights({ usage: "abc", payment: -5, support: 0 })).toEqual({ usage: 50, payment: 30, support: 20 });
  });

  it("bileşenler: koltuk sınırsızsa aktif kullanıcı varlığı; gecikme kademeleri; CSAT karışımı", () => {
    expect(usageComponent({ loginDays: 12, activeUsers: 1, seatLimit: null, moduleAreas: 6 })).toBeCloseTo(1);
    expect(usageComponent({ loginDays: 6, activeUsers: 1, seatLimit: 2, moduleAreas: 3 })).toBeCloseTo(0.5);
    expect(paymentComponent({ status: "active", subStatus: "past_due", overdueInvoices: 0, maxOverdueDays: 0 })).toBe(0.3);
    expect(paymentComponent({ status: "active", subStatus: "active", overdueInvoices: 1, maxOverdueDays: 5 })).toBe(0.7);
    expect(paymentComponent({ status: "active", subStatus: "active", overdueInvoices: 2, maxOverdueDays: 45 })).toBe(0.1);
    expect(supportComponent({ openTickets: 1, csatAvg: null, csatN: 0 })).toBe(0.8);
    expect(supportComponent({ openTickets: 0, csatAvg: 5, csatN: 3 })).toBe(1);
    expect(supportComponent({ openTickets: 0, csatAvg: 1, csatN: 3 })).toBeCloseTo(0.6);
  });

  it("kurulum ilerlemesi (SN5) biliniyorsa kullanımın %15'i; bilinmiyorsa formül değişmez", () => {
    expect(usageComponent({ ...healthy, setupPercent: null })).toBe(usageComponent(healthy));
    expect(usageComponent({ ...healthy, setupPercent: 100 })).toBeCloseTo(usageComponent(healthy));
    expect(usageComponent({ ...healthy, setupPercent: 0 })).toBeCloseTo(0.85 * usageComponent(healthy));
    const half = computeHealth({ ...healthy, setupPercent: 20 });
    expect(half.score).toBeLessThan(computeHealth(healthy).score);
    expect(half.reasons).toContain("Kurulum yarım (%20)");
    expect(computeHealth({ ...healthy, setupPercent: 80 }).reasons).toEqual([]);
  });

  it("bantlar ve süzgeç aralığı eşiğe göre", () => {
    expect(healthBand(39)).toBe("riskli");
    expect(healthBand(40)).toBe("izlenmeli");
    expect(healthBand(70)).toBe("saglikli");
    expect(healthBand(45, 50)).toBe("riskli");
    expect(healthBandRange("riskli")).toEqual({ gte: 0, lt: 40 });
    expect(healthBandRange("izlenmeli", 50)).toEqual({ gte: 50, lt: 70 });
    expect(healthBandRange("saglikli", 80)).toEqual({ gte: 80, lt: 101 });
  });
});

describe("ofis CRM yardımcıları", () => {
  it("aşama elle seçilmediyse durumdan türetilir", () => {
    expect(derivedStage("trial")).toBe("onboarding");
    expect(derivedStage("past_due")).toBe("risk");
    expect(derivedStage("cancelled")).toBe("kayip");
    expect(effectiveStage(null, "active")).toEqual({ stage: "aktif", auto: true });
    expect(effectiveStage("genisleme", "active")).toEqual({ stage: "genisleme", auto: false });
    expect(effectiveStage("çöp", "suspended")).toEqual({ stage: "risk", auto: true });
  });

  it("kayıtlı görünüm yalnız izinli parametreleri saklar (sayfa yok)", () => {
    expect(sanitizeViewParams("/admin/tenants", { etiket: "x", sorumlu: "ben", sayfa: "3", hack: "1", q: "  " })).toEqual({ etiket: "x", sorumlu: "ben" });
    expect(sanitizeViewParams("/admin/bilinmeyen", { q: "a" })).toBeNull();
    expect(viewHref("/admin/tenants", { etiket: "a", sorumlu: "ben" })).toBe("/admin/tenants?etiket=a&sorumlu=ben");
  });
});

describe("aşama süzgeci (elle seçim VEYA durumdan türeyen)", () => {
  const fake = (rows: { tenant_id: string; lifecycle_stage: string }[]) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "not", "order"]) chain[m] = () => chain;
    chain.range = async () => ({ data: rows, error: null });
    return { from: () => chain } as never;
  };

  it("türetme koşulu derivedStage'in tersidir; genişleme hiç türetilmez", () => {
    expect(derivedStatusCondition("onboarding")).toBe("status.eq.trial");
    expect(derivedStatusCondition("risk")).toBe("status.in.(past_due,suspended)");
    expect(derivedStatusCondition("genisleme")).toBeNull();
  });

  it("elle seçilenler dahil, başka aşamaya elle alınanlar türetmeden hariç", async () => {
    const or = await stageFilterOr(fake([{ tenant_id: "a", lifecycle_stage: "onboarding" }, { tenant_id: "b", lifecycle_stage: "aktif" }]), "onboarding");
    expect(or).toBe("id.in.(a),and(status.eq.trial,id.not.in.(b))");
    const none = await stageFilterOr(fake([]), "genisleme");
    expect(none).toBe("id.in.(00000000-0000-0000-0000-000000000000)");
  });
});
