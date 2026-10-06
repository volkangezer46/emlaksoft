import { describe, expect, it } from "vitest";
import { evaluateCallPriority, CALL_MAX_PER_USER, type QuietCustomerFact } from "@/lib/insights/rules/call-priority";
import { evaluateDealRisk, type StalledDealFact } from "@/lib/insights/rules/deal-risk";
import { evaluatePriceAction, PRICE_MIN_PEERS, type StaleListingFact } from "@/lib/insights/rules/price-action";
import { evaluateDeadlines, type DeadlineFact } from "@/lib/insights/rules/deadline";
import {
  detectAnomaly,
  evaluateAnomalies,
  mad,
  median,
  MIN_HISTORY_WEEKS,
  robustZ,
  type WeeklyPoint,
  type WeeklySeriesFact,
} from "@/lib/insights/rules/anomaly";
import { buildDigestDraft, DIGEST_MIN_ITEMS } from "@/lib/insights/rules/digest";
import { INSIGHT_RULES } from "@/lib/insights/rules";

// 2026-10-06 12:00 TR (UTC 09:00) — sabit saat: kurallar nowMs enjekte eder, Date.now okumaz.
const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const DAY = 86_400_000;
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("call_priority", () => {
  const base: QuietCustomerFact = { customerId: "c1", assignedTo: U1, fullName: "Ayşe Yılmaz", activeDemands: 2, quietDays: 20 };

  it("sessiz ve açık talepli müşteri için nedenli içgörü üretir", () => {
    const [d] = evaluateCallPriority([base], NOW);
    expect(d.kind).toBe("call_priority");
    expect(d.href).toBe("/app/musteriler/c1");
    expect(d.why).toContain("20 gündür");
    expect(d.evidence.map((e) => e.label)).toEqual(["Sessizlik", "Açık talep"]);
    expect(d.audience).toEqual({ type: "user", userId: U1 });
    expect(d.severity).toBe("orta"); // 2 açık talep
  });

  it("eşik altı (14 gün) ve açık talepsiz müşteri üretmez", () => {
    expect(evaluateCallPriority([{ ...base, quietDays: 13 }], NOW)).toEqual([]);
    expect(evaluateCallPriority([{ ...base, activeDemands: 0 }], NOW)).toEqual([]);
    expect(evaluateCallPriority([{ ...base, assignedTo: "" }], NOW)).toEqual([]);
  });

  it("alıcı başına en çok 3 müşteri", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...base, customerId: `c${i}`, activeDemands: 1 + (i % 3) }));
    expect(evaluateCallPriority(many, NOW)).toHaveLength(CALL_MAX_PER_USER);
  });

  it("deterministik dedupe anahtarı: aynı hafta aynı anahtar, ertesi hafta yeni", () => {
    const a = evaluateCallPriority([base], NOW)[0].dedupeKey;
    const b = evaluateCallPriority([base], NOW + 2 * 3_600_000)[0].dedupeKey;
    const nextWeek = evaluateCallPriority([base], NOW + 8 * DAY)[0].dedupeKey;
    expect(a).toBe(b);
    expect(a).not.toBe(nextWeek);
  });
});

describe("deal_risk", () => {
  const deal: StalledDealFact = {
    dealId: "d1",
    assignedTo: U1,
    stage: "negotiation",
    createdAt: new Date(NOW - 100 * DAY).toISOString(),
    updatedAt: new Date(NOW - 50 * DAY).toISOString(),
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

  it("hareketsiz ve düşük puanlı anlaşma için tahmin etiketli içgörü üretir", () => {
    const [d] = evaluateDealRisk([deal], NOW);
    expect(d.kind).toBe("deal_risk");
    expect(d.isForecast).toBe(true);
    expect(d.confidence).toBe("dusuk");
    expect(d.severity).toBe("yuksek"); // >= 45 gün
    expect(d.href).toBe("/app/anlasmalar/d1");
    expect(d.title).toContain("50 gündür");
  });

  it("eşik altı hareketsizlik ve yüksek puanlı (teklifli) anlaşma üretmez", () => {
    expect(evaluateDealRisk([{ ...deal, idleDays: 10 }], NOW)).toEqual([]);
    const healthy: StalledDealFact = {
      ...deal,
      idleDays: 15,
      updatedAt: new Date(NOW - 15 * DAY).toISOString(),
      createdAt: new Date(NOW - 20 * DAY).toISOString(),
      acceptedOffer: true,
      offerCount: 3,
      appointmentCount: 2,
      openTaskCount: 1,
    };
    expect(evaluateDealRisk([healthy], NOW)).toEqual([]);
  });

  it("dedupe anahtarı haftalık ve deterministik", () => {
    expect(evaluateDealRisk([deal], NOW)[0].dedupeKey).toBe(evaluateDealRisk([deal], NOW + 3_600_000)[0].dedupeKey);
  });
});

describe("price_action", () => {
  const fact: StaleListingFact = {
    propertyId: "p1",
    assignedTo: U1,
    propertyCode: "P-1",
    title: "Kadıköy 2+1",
    listPrice: 1_300_000,
    daysListed: 70,
    peerCount: 8,
    peerMedian: 1_000_000,
  };

  it("emsal medyanının belirgin üstündeki uzun süreli ilan için içgörü üretir ve kaynağı belirtir", () => {
    const [d] = evaluatePriceAction([fact], NOW);
    expect(d.severity).toBe("yuksek");
    expect(d.why).toContain("%30");
    expect(d.why).toContain("istenen fiyat");
    expect(d.evidence.some((e) => e.label === "Kaynak")).toBe(true);
    expect(d.href).toBe("/app/portfoyler/p1");
  });

  it("EMSAL YOKSA ÜRETMEZ (medyan null, yetersiz emsal, eşik altı fark, kısa süre)", () => {
    expect(evaluatePriceAction([{ ...fact, peerMedian: null }], NOW)).toEqual([]);
    expect(evaluatePriceAction([{ ...fact, peerCount: PRICE_MIN_PEERS - 1 }], NOW)).toEqual([]);
    expect(evaluatePriceAction([{ ...fact, listPrice: 1_050_000 }], NOW)).toEqual([]);
    expect(evaluatePriceAction([{ ...fact, daysListed: 10 }], NOW)).toEqual([]);
  });

  it("emsal sayısı az ise güven düşük", () => {
    const [d] = evaluatePriceAction([{ ...fact, peerCount: 6 }], NOW);
    expect(d.confidence).toBe("dusuk");
  });
});

describe("deadline", () => {
  const authority: DeadlineFact = { kind: "authority", entityId: "p1", assignedTo: U1, label: "Kadıköy 2+1", dueDate: "2026-10-09", daysLeft: 3 };
  const confirm: DeadlineFact = { kind: "confirm", entityId: "p2", assignedTo: U1, label: "Üsküdar 1+1", dueDate: null, daysLeft: -8 };

  it("yetki bitişi için geriye sayım ve şiddet kademesi", () => {
    const [d] = evaluateDeadlines([authority], NOW);
    expect(d.severity).toBe("yuksek");
    expect(d.title).toContain("3 gün sonra");
    expect(d.dedupeKey).toContain("2026-10-09"); // dönem = bitiş tarihi
    expect(evaluateDeadlines([{ ...authority, daysLeft: 6 }], NOW)[0].severity).toBe("orta");
    expect(evaluateDeadlines([{ ...authority, daysLeft: 12 }], NOW)[0].severity).toBe("bilgi");
  });

  it("gecikmiş teyit satır bazlı üretilir; zamanı gelmemiş teyit ve penceredışı yetki üretilmez", () => {
    const [d] = evaluateDeadlines([confirm], NOW);
    expect(d.title).toContain("15 gündür");
    expect(d.severity).toBe("orta");
    expect(d.href).toBe("/app/portallar?durum=teyit");
    expect(evaluateDeadlines([{ ...confirm, daysLeft: 2 }], NOW)).toEqual([]);
    expect(evaluateDeadlines([{ ...authority, daysLeft: 30 }], NOW)).toEqual([]);
    expect(evaluateDeadlines([{ ...authority, daysLeft: -1 }], NOW)).toEqual([]);
  });
});

describe("anomaly", () => {
  const weeks = (values: number[], currentValue = 99): WeeklyPoint[] => [
    ...values.map((value, i) => ({ weekStart: `2026-07-${String(6 + i * 7).padStart(2, "0")}`, value, isCurrent: false })),
    { weekStart: "2026-12-28", value: currentValue, isCurrent: true },
  ];

  it("yardımcılar: medyan, MAD, robust z", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([10, 12, 11, 13, 9], 11)).toBe(1);
    expect(robustZ(11, 11, 0)).toBe(0);
  });

  it("ani düşüşü yakalar: yalnız BİLGİ düzeyi, kısmi hafta kullanılmaz", () => {
    // 9 geçmiş hafta ~12, son tamamlanmış hafta 2; kısmi (current) hafta 99 olsa da dikkate alınmaz.
    const points = weeks([12, 11, 13, 12, 10, 12, 11, 13, 12, 2]);
    const r = detectAnomaly(points);
    expect(r).not.toBeNull();
    expect(r?.direction).toBe("dusus");
    const [d] = evaluateAnomalies([{ metric: "demands", points }], NOW);
    expect(d.severity).toBe("bilgi");
    expect(d.audience).toEqual({ type: "management" });
    expect(d.confidence).toBe("dusuk");
    expect(d.href).toBe("/app/talepler");
  });

  it("YETERSİZ VERİDE null: 8 haftadan az geçmiş", () => {
    const short = weeks(Array.from({ length: MIN_HISTORY_WEEKS - 1 }, () => 12).concat([2]));
    expect(detectAnomaly(short)).toBeNull();
  });

  it("küçük hacimde null (medyan < 5)", () => {
    expect(detectAnomaly(weeks([3, 2, 3, 2, 3, 2, 3, 2, 3, 0]))).toBeNull();
  });

  it("normal dalgalanmada null (eşik altı)", () => {
    expect(detectAnomaly(weeks([12, 11, 13, 12, 10, 12, 11, 13, 12, 11]))).toBeNull();
    const series: WeeklySeriesFact[] = [{ metric: "customers", points: weeks([12, 11, 13, 12, 10, 12, 11, 13, 12, 11]) }];
    expect(evaluateAnomalies(series, NOW)).toEqual([]);
  });

  it("dedupe anahtarı test edilen haftaya bağlı (deterministik)", () => {
    const points = weeks([12, 11, 13, 12, 10, 12, 11, 13, 12, 2]);
    const a = evaluateAnomalies([{ metric: "demands", points }], NOW)[0].dedupeKey;
    const b = evaluateAnomalies([{ metric: "demands", points }], NOW + DAY)[0].dedupeKey;
    expect(a).toBe(b);
  });
});

describe("digest", () => {
  const items = (n: number) => Array.from({ length: n }, () => ({ kind: "call_priority" as const, severity: "orta" as const }));

  it("eşik altında (3 maddeden az) üretmez", () => {
    expect(buildDigestDraft({ userId: U1, items: items(DIGEST_MIN_ITEMS - 1), nowMs: NOW })).toBeNull();
  });

  it("yeterli maddede kural metniyle özet üretir; digest maddeleri sayılmaz", () => {
    const d = buildDigestDraft({
      userId: U1,
      items: [...items(2), { kind: "deal_risk", severity: "yuksek" }, { kind: "digest", severity: "bilgi" }],
      nowMs: NOW,
    });
    expect(d?.title).toBe("Bugün sizin için 3 öneri var");
    expect(d?.why).toContain("2 aranacak müşteri");
    expect(d?.why).toContain("1 yüksek");
    expect(d?.kind).toBe("digest");
    expect(d?.href).toBe("/app");
  });

  it("günlük deterministik anahtar", () => {
    const a = buildDigestDraft({ userId: U1, items: items(3), nowMs: NOW })?.dedupeKey;
    const b = buildDigestDraft({ userId: U2, items: items(3), nowMs: NOW + 3_600_000 })?.dedupeKey;
    expect(a).toBe(b);
    expect(a).toContain("2026-10-06");
  });
});

describe("kural kayıt listesi", () => {
  it("ilk 5 olgu kuralı kayıtlı, kimlikler sürümlü ve benzersiz", () => {
    const ids = INSIGHT_RULES.map((r) => r.id);
    expect(ids).toEqual(["call_priority@1", "deal_risk@1", "price_action@1", "deadline@1", "anomaly@1"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of INSIGHT_RULES) expect(r.id).toMatch(/^[a-z_]+@\d+$/);
  });
});
