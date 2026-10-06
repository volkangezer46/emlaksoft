import { describe, expect, it } from "vitest";
import { buildOwnerQuestions, pickRiskDistrict } from "./owner-questions";
import { emptySummary } from "./helpers";

describe("ofis sahibinin 12 sorusu", () => {
  it("12 soru; her biri tıklanabilir filtreli hedef; sayı kaynağıyla aynı", () => {
    const q = buildOwnerQuestions({
      summary: { ...emptySummary(), total_active: 184, in_portals: 170, awaiting_publish: 7, portal_missing: 3, price_mismatch: 2, in_review: 9, healthy: 171 },
      counts: { portal_missing: 2, authority_expiring: 4, potential_lost_deal: 1, sold_still_listed: 1 },
      changes: { anomalies_opened: 5, anomalies_closed: 2, newly_missing: 1 },
      worstAdvisor: { id: "a1", name: "Ayşe", issues: 4, active: 20 },
      overdueAdvisors: [{ id: "a2", name: "Mehmet", count: 3 }],
      riskDistrict: { id: "d1", name: "Kadıköy", missing: 2, inReview: 3 },
    });
    expect(q).toHaveLength(12);
    for (const x of q) expect(x.href).toMatch(/^\/app\/ilan-kontrol/);
    const by = Object.fromEntries(q.map((x) => [x.key, x]));
    expect(by.total.href).toBe("/app/ilan-kontrol/liste?kpi=active");
    expect(by.awaiting.value).toBe(7);
    expect(by.no_crm.href).toBe("/app/ilan-kontrol/anomaliler?tur=portal_missing");
    expect(by.unrecorded.value).toBe(2);
    expect(by.warn_today.href).toBe("/app/ilan-kontrol/anomaliler?danisman=a2");
    expect(by.risk_where.href).toBe("/app/ilan-kontrol/liste?kpi=portal_missing&ilce=d1");
  });
  it("veri yoksa sahte sayı yok: dürüst cevap", () => {
    const q = buildOwnerQuestions({ summary: emptySummary(), counts: {}, changes: null, worstAdvisor: null, overdueAdvisors: [], riskDistrict: null });
    const by = Object.fromEntries(q.map((x) => [x.key, x]));
    expect(by.yesterday.value).toBeNull();
    expect(by.advisor.value).toBeNull();
    expect(by.published.answer).toBe("Aktif portföy yok");
  });
  it("risk bölgesi: kayıp+inceleme en yüksek ilçe; ilçesiz satır adlandırılır", () => {
    expect(
      pickRiskDistrict([
        { district_id: "d1", district_name: "Kadıköy", portal_missing: 1, in_review: 1, total_active: 50 },
        { district_id: null, district_name: null, portal_missing: 3, in_review: 0, total_active: 5 },
      ]),
    ).toEqual({ id: null, name: "İlçesi girilmemiş", missing: 3, inReview: 0 });
    expect(pickRiskDistrict([])).toBeNull();
  });
});
