import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  buildCustomerState,
  callPriorityLevel,
  computeCustomerHeat,
  temperatureOf,
  type CustomerStateInput,
  type HeatRpcSignals,
  type LeadRpcSignals,
} from "@/lib/customer-state/core";
import { CALL_MIN_QUIET_DAYS, HEAT_CUTS } from "@/lib/customer-state/thresholds";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

const heatSig = (o: Partial<HeatRpcSignals> = {}): HeatRpcSignals => ({
  last_contact: null,
  open_demands: 0,
  urgent_demands: 0,
  portal_likes_30d: 0,
  open_offers: 0,
  open_deals: 0,
  ...o,
});
const leadSig = (o: Partial<LeadRpcSignals> = {}): LeadRpcSignals => ({
  active_demands: 0,
  comms: 0,
  appts: 0,
  calls: 0,
  last_activity: null,
  ...o,
});
const input = (o: Partial<CustomerStateInput> = {}): CustomerStateInput => ({
  customerId: "c1",
  createdAt: ago(300),
  blacklist: false,
  hasPhone: true,
  hasEmail: true,
  source: "tavsiye",
  types: ["Alıcı"],
  leadSignals: leadSig(),
  heatSignals: heatSig(),
  hasUpcomingAppointment: false,
  ...o,
});

describe("buildCustomerState — veri yokken", () => {
  it("hiç sinyal verisi yok: risk null, sonraki aksiyon null, sıcaklık soğuk", () => {
    const s = buildCustomerState(input({ leadSignals: null, heatSignals: null }), NOW);
    expect(s.risk).toBeNull();
    expect(s.nextBestAction).toBeNull();
    expect(s.temperature).toBe("soguk");
    expect(s.scores.seller).toBeNull();
  });

  it("kara liste: risk null, aksiyon yok, gerekçe yok, aşama kara_liste", () => {
    const s = buildCustomerState(input({ blacklist: true, heatSignals: heatSig({ last_contact: ago(1), open_demands: 3 }) }), NOW);
    expect(s.risk).toBeNull();
    expect(s.nextBestAction).toBeNull();
    expect(s.reasons).toEqual([]);
    expect(s.stage).toBe("kara_liste");
    expect(s.temperature).toBe("soguk");
  });
});

describe("sıcaklık eşikleri (ısı skoru tek kaynak)", () => {
  it("segment → sıcaklık eşlemesi", () => {
    expect(temperatureOf("sicak")).toBe("sicak");
    expect(temperatureOf("ilgili")).toBe("ilik");
    expect(temperatureOf("soguk")).toBe("soguk");
    expect(temperatureOf("uykuda")).toBe("soguk");
  });

  it("dün temas + acil talep + açık teklif → sıcak (>= HEAT_CUTS.sicak)", () => {
    const s = buildCustomerState(
      input({ heatSignals: heatSig({ last_contact: ago(1), open_demands: 2, urgent_demands: 1, open_offers: 1 }) }),
      NOW,
    );
    expect(s.scores.heat.score).toBeGreaterThanOrEqual(HEAT_CUTS.sicak);
    expect(s.temperature).toBe("sicak");
  });

  it("orta düzey sinyal → ılık (40..69)", () => {
    // son temas 10 gün (21) + 1 açık talep (10) + açık anlaşma (18) = 49
    const s = buildCustomerState(input({ heatSignals: heatSig({ last_contact: ago(10), open_demands: 1, open_deals: 1 }) }), NOW);
    expect(s.scores.heat.score).toBe(49);
    expect(s.temperature).toBe("ilik");
  });

  it("eşik sınırları: 70 sıcak, 69 ılık; 40 ılık, 39 soğuk", () => {
    expect(HEAT_CUTS.sicak).toBe(70);
    expect(HEAT_CUTS.ilgili).toBe(40);
    expect(HEAT_CUTS.soguk).toBe(15);
  });

  it("uzun sessiz müşteri → soğuk (uykuda dâhil) ve aşama uykuda", () => {
    const s = buildCustomerState(input({ createdAt: ago(400), heatSignals: heatSig({ last_contact: ago(200) }) }), NOW);
    expect(s.temperature).toBe("soguk");
    expect(s.scores.heat.segment).toBe("uykuda");
    expect(s.stage).toBe("uykuda");
  });

  it("ofis tanımlı uykuda eşiği ısıya iletilir", () => {
    const i = input({ createdAt: ago(400), heatSignals: heatSig({ last_contact: ago(50) }) });
    expect(buildCustomerState(i, NOW).scores.heat.segment).toBe("soguk");
    expect(buildCustomerState(i, NOW, { dormantDays: 45 }).scores.heat.segment).toBe("uykuda");
  });
});

describe("risk eşikleri (churn tek kaynak)", () => {
  it("değerli + uzun sessiz → yüksek risk, aksiyon 'kurtar', gerekçe href'li", () => {
    const s = buildCustomerState(
      input({
        leadSignals: leadSig({ active_demands: 2, comms: 6, calls: 4, appts: 2, last_activity: ago(100) }),
        heatSignals: heatSig({ last_contact: ago(100), open_demands: 2 }),
      }),
      NOW,
    );
    expect(s.risk).toBe("yuksek");
    expect(s.nextBestAction?.key).toBe("kurtar");
    expect(s.reasons[0]!.label).toBe("Yüksek kayıp riski");
    for (const r of s.reasons) expect(r.href).toMatch(/^\/app\//);
  });

  it("taze temas → düşük risk", () => {
    const s = buildCustomerState(input({ heatSignals: heatSig({ last_contact: ago(2) }) }), NOW);
    expect(s.risk).toBe("dusuk");
  });

  it("planlı randevu riski düşürür (yüksek -> düşük) ve aşama randevulu", () => {
    const base = input({ heatSignals: heatSig({ last_contact: ago(150) }), leadSignals: leadSig({ last_activity: ago(150), comms: 5 }) });
    expect(buildCustomerState(base, NOW).risk).not.toBe("dusuk");
    const s = buildCustomerState({ ...base, hasUpcomingAppointment: true }, NOW);
    expect(s.risk).toBe("dusuk");
    expect(s.stage).toBe("randevulu");
    expect(s.nextBestAction?.key).toBe("teyit");
  });
});

describe("aşama ve sonraki aksiyon", () => {
  it("açık anlaşma > teklif > randevu > talep sırası", () => {
    expect(buildCustomerState(input({ heatSignals: heatSig({ open_deals: 1, open_offers: 1 }) }), NOW).stage).toBe("anlasma");
    expect(buildCustomerState(input({ heatSignals: heatSig({ open_offers: 1 }) }), NOW).stage).toBe("teklif");
    expect(buildCustomerState(input({ hasUpcomingAppointment: true, heatSignals: heatSig({ open_demands: 1 }) }), NOW).stage).toBe("randevulu");
    expect(buildCustomerState(input({ heatSignals: heatSig({ last_contact: ago(5), open_demands: 1 }) }), NOW).stage).toBe("talep");
  });

  it("sıcak ve randevusuz → randevu aksiyonu", () => {
    const s = buildCustomerState(
      input({ heatSignals: heatSig({ last_contact: ago(1), open_demands: 2, urgent_demands: 1, open_offers: 1 }) }),
      NOW,
    );
    expect(s.nextBestAction?.key).toBe("randevu");
  });

  it("malik-tipi müşteri: satıcı skoru hesaplanır; yüksekse portföy_iste", () => {
    const s = buildCustomerState(
      input({
        types: ["Mülk sahibi"],
        createdAt: ago(800),
        wonDeals: 2,
        hasListingIntentDemand: true,
        leadSignals: leadSig({ last_activity: ago(60), comms: 1 }),
        heatSignals: heatSig({ last_contact: ago(60) }),
      }),
      NOW,
    );
    expect(s.scores.seller).not.toBeNull();
    expect(s.scores.seller!.tier).toBe("high");
    expect(s.risk).not.toBe("yuksek");
    expect(s.nextBestAction?.key).toBe("portfoy_iste");
  });
});

describe("tek tanım: yalnız ısı havuzu = tam durum ısısı", () => {
  it("computeCustomerHeat, buildCustomerState().scores.heat ile birebir aynı", () => {
    const hs = heatSig({ last_contact: ago(9), open_demands: 1, portal_likes_30d: 2, open_deals: 1 });
    const full = buildCustomerState(input({ heatSignals: hs }), NOW, { dormantDays: 60 });
    const pool = computeCustomerHeat({ createdAt: ago(300), blacklist: false }, hs, NOW, { dormantDays: 60 });
    expect(pool).toEqual(full.scores.heat);
  });
});

describe("callPriorityLevel (bugün ara)", () => {
  it("açık talep yok veya sessizlik eşik altı → null", () => {
    expect(callPriorityLevel({ activeDemands: 0, quietDays: 90 })).toBeNull();
    expect(callPriorityLevel({ activeDemands: 1, quietDays: CALL_MIN_QUIET_DAYS - 1 })).toBeNull();
  });
  it("eşik: 14 gün bilgi, 30 gün veya 2 talep orta; ofis eşiği geçerli", () => {
    expect(callPriorityLevel({ activeDemands: 1, quietDays: 14 })).toBe("bilgi");
    expect(callPriorityLevel({ activeDemands: 1, quietDays: 30 })).toBe("orta");
    expect(callPriorityLevel({ activeDemands: 2, quietDays: 14 })).toBe("orta");
    expect(callPriorityLevel({ activeDemands: 1, quietDays: 10 }, 7)).toBe("bilgi");
  });
});
