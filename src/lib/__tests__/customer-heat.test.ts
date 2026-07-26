import { describe, expect, it } from "vitest";
import { DORMANT_DAYS, scoreCustomerHeat, heatTitle } from "@/lib/customer-heat";
import { DAY_MS } from "@/lib/clock";

/** Sabit "şimdi" — testler duvar saatinden bağımsız. */
const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);
const daysAgo = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

const base = {
  lastContactAt: null as string | null,
  openDemands: 0,
  urgentDemands: 0,
  portalLikes30d: 0,
  hasOpenOfferOrDeal: false,
  createdAt: daysAgo(200),
};

describe("scoreCustomerHeat", () => {
  it("dün temas + acil talep + açık teklif → sıcak (≥70)", () => {
    const heat = scoreCustomerHeat(
      {
        ...base,
        lastContactAt: daysAgo(1),
        openDemands: 2,
        urgentDemands: 1,
        hasOpenOfferOrDeal: true,
      },
      NOW,
    );
    // 35 (temas) + 20 (talep) + 8 (acil) + 18 (teklif) = 81
    expect(heat.score).toBe(81);
    expect(heat.segment).toBe("sicak");
    expect(heat.label).toBe("Sıcak");
  });

  it("yakın temas + tek açık talep → ilgili (40-69)", () => {
    const heat = scoreCustomerHeat(
      { ...base, lastContactAt: daysAgo(2), openDemands: 1 },
      NOW,
    );
    // 35 + 10 = 45
    expect(heat.score).toBe(45);
    expect(heat.segment).toBe("ilgili");
  });

  it("45 gün önce temas, başka sinyal yok → soğuk (15-39 değil ama <90 gün temassız, uykuda olamaz)", () => {
    const heat = scoreCustomerHeat({ ...base, lastContactAt: daysAgo(45) }, NOW);
    // 6 puan — <15 ama temassızlık 90 günü aşmadığı için uykuda DEĞİL
    expect(heat.score).toBe(6);
    expect(heat.segment).toBe("soguk");
    expect(heat.daysSinceContact).toBe(45);
  });

  it("120 gündür temassız, sinyal yok → uykuda + temassız gün sayısı", () => {
    const heat = scoreCustomerHeat({ ...base, lastContactAt: daysAgo(120) }, NOW);
    expect(heat.score).toBeLessThan(15);
    expect(heat.segment).toBe("uykuda");
    expect(heat.daysSinceContact).toBe(120);
    expect(heatTitle(heat)).toContain("120 gündür temassız");
  });

  it("hiç teması olmayan eski kayıt → temassız süre kayıt yaşından okunur, uykuda", () => {
    const heat = scoreCustomerHeat({ ...base, createdAt: daysAgo(DORMANT_DAYS) }, NOW);
    expect(heat.segment).toBe("uykuda");
    expect(heat.daysSinceContact).toBe(DORMANT_DAYS);
  });

  it("yeni kayıt (bugün) hiç sinyalsiz → 'yeni kayıt' puanıyla soğuk, uykuda değil", () => {
    const heat = scoreCustomerHeat({ ...base, createdAt: daysAgo(0) }, NOW);
    expect(heat.score).toBe(6); // yalnız yeni kayıt tazeliği
    expect(heat.segment).toBe("soguk");
  });

  it("portal beğenileri 15 puanda kırpılır, toplam skor 100'ü aşamaz", () => {
    const heat = scoreCustomerHeat(
      {
        ...base,
        createdAt: daysAgo(3),
        lastContactAt: daysAgo(0),
        openDemands: 5,
        urgentDemands: 2,
        portalLikes30d: 10,
        hasOpenOfferOrDeal: true,
      },
      NOW,
    );
    expect(heat.factors.find((f) => f.label.startsWith("Portal"))?.points).toBe(15);
    expect(heat.factors.find((f) => f.label === "Açık talep")?.points).toBe(20);
    expect(heat.score).toBe(100);
    expect(heat.segment).toBe("sicak");
  });

  it("kara liste → skor 0; 90+ gün temassızsa uykuda", () => {
    const cold = scoreCustomerHeat(
      { ...base, lastContactAt: daysAgo(5), openDemands: 3, blacklist: true },
      NOW,
    );
    expect(cold.score).toBe(0);
    expect(cold.segment).toBe("soguk");

    const dormant = scoreCustomerHeat(
      { ...base, lastContactAt: daysAgo(150), blacklist: true },
      NOW,
    );
    expect(dormant.segment).toBe("uykuda");
  });

  it("aynı girdi farklı nowMs → skor değişir (saf fonksiyon, now parametrik)", () => {
    const inputs = { ...base, lastContactAt: daysAgo(2), openDemands: 1 };
    const today = scoreCustomerHeat(inputs, NOW);
    const monthLater = scoreCustomerHeat(inputs, NOW + 35 * DAY_MS);
    expect(today.score).toBeGreaterThan(monthLater.score);
    expect(monthLater.segment).toBe("soguk");
  });

  it("heatTitle bileşen dökümünü içerir", () => {
    const heat = scoreCustomerHeat(
      { ...base, lastContactAt: daysAgo(1), openDemands: 1 },
      NOW,
    );
    const title = heatTitle(heat);
    expect(title).toContain("Sıcaklık 45/100");
    expect(title).toContain("Son temas: +35");
    expect(title).toContain("Açık talep: +10");
  });
});
