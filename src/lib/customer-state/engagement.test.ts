import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { buildCustomerState, type CustomerStateInput, type HeatRpcSignals } from "@/lib/customer-state/core";
import { DIGITAL_CAP, digitalFactors, isDigitalFactor, scoreCustomerHeat } from "@/lib/customer-state/heat";
import { computeLeadScore } from "@/lib/customer-state/lead";

/** CRM-G10: davranışsal ısı — sunum açılışı, portal girişi ve portal isteği müşteri sıcaklığını besler. */
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

const base = { lastContactAt: ago(45), openDemands: 1, urgentDemands: 0, portalLikes30d: 0, hasOpenOfferOrDeal: false, createdAt: ago(200) };

describe("dijital ilgi faktörleri", () => {
  it("sinyal yoksa faktör yok ve ısı eskisiyle aynı", () => {
    expect(digitalFactors(base, NOW)).toEqual([]);
    const old = scoreCustomerHeat(base, NOW);
    expect(scoreCustomerHeat({ ...base, presentationsViewed7d: 0, portalRequests14d: 0, portalSeenAt: null, engagedAt: null }, NOW)).toEqual(old);
  });

  it("açıklama çipi etiketleri sayıyı taşır; üst sınır uygulanır", () => {
    const f = digitalFactors({ ...base, presentationsViewed7d: 3, portalSeenAt: ago(2), portalRequests14d: 4, engagedAt: ago(1) }, NOW);
    expect(f[0]).toEqual({ label: "Sunum açtı ×3 (7 gün)", points: 12 });
    expect(f.map((x) => x.label)).toContain("Portala girdi (7 gün)");
    expect(f.reduce((n, x) => n + x.points, 0)).toBe(DIGITAL_CAP);
    expect(f.every((x) => isDigitalFactor(x.label))).toBe(true);
  });

  it("eski portal girişi (7 günden eski) ve 72 saatten eski ilgi puan vermez", () => {
    expect(digitalFactors({ ...base, portalSeenAt: ago(9), engagedAt: ago(4) }, NOW)).toEqual([]);
  });

  it("sunumu bugün iki kez açan müşteri soğuktan ilgiliye çıkar", () => {
    const quiet = { ...base, lastContactAt: ago(20) };
    const cold = scoreCustomerHeat(quiet, NOW);
    const warm = scoreCustomerHeat({ ...quiet, presentationsViewed7d: 2, engagedAt: ago(0.2) }, NOW);
    expect(cold.segment).toBe("soguk");
    expect(warm.score - cold.score).toBe(20);
    expect(warm.segment).toBe("ilgili");
  });
});

describe("tek okuyucu (core) dijital ilgiyi taşır", () => {
  const signals: HeatRpcSignals = {
    last_contact: ago(45), open_demands: 1, urgent_demands: 0, portal_likes_30d: 0, open_offers: 0, open_deals: 0,
    presentations_viewed_7d: 1, portal_seen_at: ago(1), portal_requests_14d: 0, engaged_at: ago(1),
  };
  const input: CustomerStateInput = {
    customerId: "c1", createdAt: ago(200), blacklist: false, hasPhone: true, hasEmail: false, source: "web_sitesi",
    types: ["Alıcı"], leadSignals: null, heatSignals: signals, hasUpcomingAppointment: false,
  };

  it("nedenler portal geçmişine bağlanır; aday skoruna dijital ilgi kalemi girer", () => {
    const s = buildCustomerState(input, NOW);
    const r = s.reasons.find((x) => x.label.startsWith("Sunum açtı"));
    expect(r?.href).toBe("/app/musteriler/c1?sekme=gecmis&kategori=portal");
    expect(s.scores.lead.factors.find((f) => f.label.startsWith("Dijital ilgi"))?.points).toBe(10);
  });

  it("eski RPC (kolonlar yok) → dijital puan 0", () => {
    const legacy = { ...signals } as Partial<HeatRpcSignals>;
    delete legacy.presentations_viewed_7d;
    delete legacy.portal_seen_at;
    delete legacy.portal_requests_14d;
    delete legacy.engaged_at;
    const s = buildCustomerState({ ...input, heatSignals: legacy as HeatRpcSignals }, NOW);
    expect(s.scores.heat.factors.some((f) => isDigitalFactor(f.label))).toBe(false);
  });

  it("aday skoru dijital ilgiyi en çok 12 puanla alır", () => {
    const mk = (d: number) => computeLeadScore({ hasPhone: true, hasEmail: false, source: null, activeDemands: 0, communications: 0, appointments: 0, calls: 0, lastActivityAt: null, createdAt: ago(200), blacklist: false, digitalInterest: d });
    expect(mk(0).factors.some((f) => f.label.startsWith("Dijital"))).toBe(false);
    expect(mk(100).factors.find((f) => f.label.startsWith("Dijital"))?.points).toBe(12);
  });
});
