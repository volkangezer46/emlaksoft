import { describe, expect, it } from "vitest";
import { evaluateDealRisk, type StalledDealFact } from "@/lib/insights/rules/deal-risk";
import { evaluateUnshownMatches, type UnshownMatchFact } from "@/lib/insights/rules/revenue";

const NOW = Date.UTC(2026, 9, 8, 9, 0, 0);
const DAY = 86_400_000;
const U1 = "11111111-1111-4111-8111-111111111111";
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe("deal_risk: aşamada geçen gün + beklenen kapanış (B9)", () => {
  const deal: StalledDealFact = {
    dealId: "d1",
    assignedTo: U1,
    stage: "negotiation",
    createdAt: iso(100),
    updatedAt: iso(2), // not eklendi: eski ölçü "taze" derdi
    stageChangedAt: iso(50),
    idleDays: 50,
    offerCount: 0,
    acceptedOffer: false,
    openTaskCount: 0,
    appointmentCount: 0,
    dealValue: null,
    listPrice: null,
    propertyTitle: "Bağcılar 3+1",
    propertyCode: "P-1",
  };

  it("son güncelleme yeni olsa da aşamada uzun bekleyen anlaşma risklidir", () => {
    const [d] = evaluateDealRisk([deal], NOW);
    expect(d.title).toContain("50 gündür aynı aşamada");
    expect(d.evidence.find((e) => e.label === "Aşamada")?.value).toBe("50 gün");
  });

  it("eşik altı ama beklenen kapanışı geçmiş anlaşma kart üretir (yüksek puanlı değilse)", () => {
    const [d] = evaluateDealRisk(
      [{ ...deal, idleDays: 5, stageChangedAt: iso(5), expectedCloseDate: "2026-09-20", closeOverdueDays: 18 }],
      NOW,
    );
    expect(d.title).toContain("beklenen kapanış 18 gün geçti");
    expect(d.severity).toBe("orta"); // 45 gün altı
    expect(d.evidence.some((e) => e.label === "Beklenen kapanış")).toBe(true);
  });

  it("kapanışı gecikmemiş ve eşik altı anlaşma üretmez", () => {
    expect(evaluateDealRisk([{ ...deal, idleDays: 5, stageChangedAt: iso(5), closeOverdueDays: 0 }], NOW)).toEqual([]);
  });
});

describe("unshown_match: CRM-G4 çift durumu (B9)", () => {
  const base: UnshownMatchFact = {
    demandId: "d1",
    propertyId: "11111111-aaaa",
    customerName: "Ayşe",
    propertyLabel: "Kadıköy 2+1",
    assignedTo: U1,
    score: 82,
    pairAgeDays: 5,
    hasAppointment: false,
  };

  it("gösterildi / beğenmedi / uygun değil işaretli çift kart üretmez", () => {
    for (const matchState of ["shown", "disliked", "dismissed"] as const) {
      expect(evaluateUnshownMatches([{ ...base, matchState }], NOW)).toEqual([]);
    }
  });

  it("gönderilmiş ama gösterilmemiş çift 'gönderildi, gösterim yok' der; beğenildiyse önem orta", () => {
    const [sent] = evaluateUnshownMatches([{ ...base, matchState: "viewed" }], NOW);
    expect(sent.title).toContain("Gönderildi, gösterim yok");
    expect(sent.why).toContain("açıldı");
    const [liked] = evaluateUnshownMatches([{ ...base, matchState: "liked" }], NOW);
    expect(liked.severity).toBe("orta");
  });

  it("durum yoksa eski davranış", () => {
    const [d] = evaluateUnshownMatches([{ ...base, matchState: null }], NOW);
    expect(d.title).toContain("Güçlü eşleşme, gösterim yok");
  });
});
