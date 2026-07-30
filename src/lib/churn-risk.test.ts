import { describe, it, expect } from "vitest";
import { computeChurnRisk, type ChurnSignals } from "./churn-risk";

const base: ChurnSignals = {
  daysSinceContact: 45,
  engagementScore: 70,
  openDemands: 1,
  hasUpcomingAppointment: false,
  blacklist: false,
};

describe("computeChurnRisk", () => {
  it("kara liste = uygulanmaz", () => {
    const r = computeChurnRisk({ ...base, blacklist: true });
    expect(r.tier).toBe("na");
    expect(r.risk).toBe(0);
  });

  it("planlı randevu riski düşürür", () => {
    const r = computeChurnRisk({ ...base, daysSinceContact: 200, hasUpcomingAppointment: true });
    expect(r.tier).toBe("low");
    expect(r.action).toContain("randevu");
  });

  it("değerli + uzun sessiz = yüksek risk", () => {
    const r = computeChurnRisk({ daysSinceContact: 100, engagementScore: 90, openDemands: 2, hasUpcomingAppointment: false, blacklist: false });
    expect(r.tier).toBe("high");
    expect(r.risk).toBeGreaterThanOrEqual(60);
  });

  it("değersiz (hiç etkileşim yok) + sessiz, değerli sessizden düşük risk taşır", () => {
    const degerli = computeChurnRisk({ ...base, daysSinceContact: 100, engagementScore: 90 }).risk;
    const degersiz = computeChurnRisk({ ...base, daysSinceContact: 100, engagementScore: 5 }).risk;
    expect(degerli).toBeGreaterThan(degersiz);
  });

  it("yeni temas = düşük risk", () => {
    const r = computeChurnRisk({ ...base, daysSinceContact: 3, openDemands: 0 });
    expect(r.tier).toBe("low");
  });

  it("açık talep riski artırır", () => {
    const talepli = computeChurnRisk({ ...base, openDemands: 2 }).risk;
    const talepsiz = computeChurnRisk({ ...base, openDemands: 0 }).risk;
    expect(talepli).toBeGreaterThan(talepsiz);
  });

  it("skor 0..100 aralığında", () => {
    const r = computeChurnRisk({ daysSinceContact: 999, engagementScore: 100, openDemands: 99, hasUpcomingAppointment: false, blacklist: false });
    expect(r.risk).toBeLessThanOrEqual(100);
    expect(r.risk).toBeGreaterThanOrEqual(0);
  });
});
