import { describe, expect, it } from "vitest";
import { computePriority, explainPriority, impactScale, urgencyPoints } from "@/lib/insights/priority";
import { buildDedupeKey, dayPeriod, dedupeDrafts, monthPeriod, suppressionKey, weekPeriod } from "@/lib/insights/dedupe";
import { QUALITY_MIN_REVIEWED, qualitySuppressedRules } from "@/lib/insights/quality";
import { isRuleMuted, normalizeInsightSettings } from "@/lib/insights/settings";
import { DEFAULT_INSIGHT_SETTINGS, ruleBase } from "@/lib/insights/types";
import { isReadable, mapInsightRow, selectReadable, type InsightDbRow } from "@/lib/insights/readable";
import { normalizeThresholds } from "@/lib/oversight/settings";

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("öncelik formülü", () => {
  it("şiddet tabanı + aciliyet + etki - bastırma, 0..100 kırpılır", () => {
    expect(computePriority({ severity: "bilgi" }).priority).toBe(20);
    expect(computePriority({ severity: "orta", urgencyDays: 2, impact: 4 }).priority).toBe(45 + 15 + 4);
    expect(computePriority({ severity: "yuksek", urgencyDays: 0, impact: 99 }).priority).toBe(100);
    expect(computePriority({ severity: "bilgi", recentDismissals: 99 }).priority).toBe(0);
  });
  it("aciliyet kademeleri ve açıklama metni", () => {
    expect([urgencyPoints(-3), urgencyPoints(3), urgencyPoints(7), urgencyPoints(15), urgencyPoints(16), urgencyPoints(null)]).toEqual([20, 15, 10, 5, 0, 0]);
    expect(explainPriority(computePriority({ severity: "orta", urgencyDays: 5 }))).toBe("şiddet 45 · aciliyet +10 = 55");
  });
  it("etki ölçeği monoton ve 0..10", () => {
    expect(impactScale(0)).toBe(0);
    expect(impactScale(1)).toBeLessThanOrEqual(impactScale(10));
    expect(impactScale(10)).toBeLessThanOrEqual(impactScale(1000));
    expect(impactScale(1_000_000_000)).toBe(10);
  });
});

describe("dedupe", () => {
  it("anahtar deterministik, güvenli karakterli ve 200 altı", () => {
    expect(buildDedupeKey("call", "c1", "2026-10-05")).toBe("call:c1:2026-10-05");
    expect(buildDedupeKey("call", "a b/ç", null)).toBe("call:a_b__");
    expect(buildDedupeKey("x", "y".repeat(500)).length).toBeLessThanOrEqual(200);
  });
  it("dönem anahtarları TR takvimiyle", () => {
    expect(dayPeriod(NOW)).toBe("2026-10-06");
    expect(monthPeriod(NOW)).toBe("2026-10");
    expect(weekPeriod(NOW)).toBe("2026-10-05"); // pazartesi
    // Pazar gecesi 23:30 TR hâlâ aynı hafta; pazartesi 00:30 TR yeni hafta.
    const sundayLate = Date.UTC(2026, 9, 11, 20, 30); // 23:30 TR
    const mondayEarly = Date.UTC(2026, 9, 11, 21, 30); // 00:30 TR pazartesi
    expect(weekPeriod(sundayLate)).toBe("2026-10-05");
    expect(weekPeriod(mondayEarly)).toBe("2026-10-12");
  });
  it("dedupeDrafts ilk geleni tutar", () => {
    const items = [
      { recipientUserId: "u1", draft: { dedupeKey: "k" }, n: 1 },
      { recipientUserId: "u1", draft: { dedupeKey: "k" }, n: 2 },
      { recipientUserId: "u2", draft: { dedupeKey: "k" }, n: 3 },
    ];
    expect(dedupeDrafts(items).map((i) => i.n)).toEqual([1, 3]);
  });
  it("bastırma anahtarı", () => {
    expect(suppressionKey("u", "deal_risk", "d1")).toBe("u|deal_risk|d1");
    expect(suppressionKey("u", "anomaly", null)).toBe("u|anomaly|-");
  });
});

describe("kural kalite bastırması (yanlış alarm)", () => {
  it("örneklem yetersizse bastırmaz", () => {
    expect(qualitySuppressedRules([{ ruleId: "deal_risk@1", accepted: 0, dismissed: QUALITY_MIN_REVIEWED - 1, dismissedWrong: QUALITY_MIN_REVIEWED - 1 }]).size).toBe(0);
  });
  it("yanlış oranı > %40 ve yeterli örneklemde kuralı (taban adıyla) bastırır", () => {
    const s = qualitySuppressedRules([{ ruleId: "deal_risk@1", accepted: 2, dismissed: 10, dismissedWrong: 8 }]);
    expect(s.has("deal_risk")).toBe(true);
  });
  it("oran eşiğin altındaysa bastırmaz; sürümler birleştirilir", () => {
    expect(qualitySuppressedRules([{ ruleId: "deal_risk@1", accepted: 8, dismissed: 4, dismissedWrong: 4 }]).size).toBe(0); // %33
    const merged = qualitySuppressedRules([
      { ruleId: "price_action@1", accepted: 0, dismissed: 6, dismissedWrong: 6 },
      { ruleId: "price_action@2", accepted: 0, dismissed: 6, dismissedWrong: 6 },
    ]);
    expect(merged.has("price_action")).toBe(true);
  });
});

describe("ofis ayarı (oversight_settings.thresholds.insights)", () => {
  it("varsayılan: sessiz kural yok, LLM anlatımı KAPALI", () => {
    expect(normalizeInsightSettings(undefined)).toEqual(DEFAULT_INSIGHT_SETTINGS);
    expect(DEFAULT_INSIGHT_SETTINGS.narrativeEnabled).toBe(false);
  });
  it("bozuk girdi güvenli: yalnız geçerli kural simgeleri, narrativeEnabled yalnız true ile açılır", () => {
    const s = normalizeInsightSettings({ mutedRules: ["deal_risk", "DROP TABLE", 5, "deal_risk"], narrativeEnabled: "true" });
    expect(s.mutedRules).toEqual(["deal_risk"]);
    expect(s.narrativeEnabled).toBe(false);
    expect(normalizeInsightSettings({ narrativeEnabled: true }).narrativeEnabled).toBe(true);
  });
  it("sessize alma hem tam kimlik hem taban ada uyar", () => {
    const s = normalizeInsightSettings({ mutedRules: ["deal_risk"] });
    expect(isRuleMuted(s, "deal_risk@1")).toBe(true);
    expect(isRuleMuted(s, "call_priority@1")).toBe(false);
    expect(ruleBase("a@2")).toBe("a");
  });
  it("oversight thresholds normalizasyonu insights alanını KORUR (ofis kontrol formu kaydedince silinmez)", () => {
    const t = normalizeThresholds({ priceDropPct: 12, insights: { mutedRules: ["anomaly"], narrativeEnabled: true } });
    expect(t.priceDropPct).toBe(12);
    expect(t.insights).toEqual({ mutedRules: ["anomaly"], narrativeEnabled: true });
    expect(normalizeThresholds({}).insights).toBeUndefined();
  });
});

const row = (over: Partial<InsightDbRow> = {}): InsightDbRow => ({
  id: "i1",
  kind: "deal_risk",
  rule_id: "deal_risk@1",
  severity: "orta",
  priority: 55,
  title: "T",
  why: "W",
  evidence: [{ label: "a", value: "b", href: "/app/x" }, { label: 1 }, null],
  href: "/app/anlasmalar/d1",
  entity_type: "deal",
  entity_id: "d1",
  is_forecast: true,
  confidence: "dusuk",
  state: "new",
  snoozed_until: null,
  valid_until: new Date(NOW + DAY).toISOString(),
  created_at: new Date(NOW - HOUR).toISOString(),
  narrative: null,
  narrative_source: "rule",
  ...over,
});

describe("okunabilirlik (süresi geçen okunmaz)", () => {
  it("süresi geçmiş, yoksayılmış, uygulanmış satır okunmaz", () => {
    expect(isReadable(row(), NOW)).toBe(true);
    expect(isReadable(row({ valid_until: new Date(NOW - 1).toISOString() }), NOW)).toBe(false);
    expect(isReadable(row({ valid_until: new Date(NOW).toISOString() }), NOW)).toBe(false);
    expect(isReadable(row({ state: "dismissed" }), NOW)).toBe(false);
    expect(isReadable(row({ state: "accepted" }), NOW)).toBe(false);
  });
  it("ertelenmiş satır erteleme bitene kadar gizli, sonra tekrar görünür", () => {
    expect(isReadable(row({ state: "snoozed", snoozed_until: new Date(NOW + HOUR).toISOString() }), NOW)).toBe(false);
    expect(isReadable(row({ state: "snoozed", snoozed_until: new Date(NOW - HOUR).toISOString() }), NOW)).toBe(true);
    expect(isReadable(row({ state: "snoozed", snoozed_until: null }), NOW)).toBe(false);
  });
  it("seçim: önceliğe göre sıralar, limit uygular, süresi geçeni eler", () => {
    const rows = [
      row({ id: "a", priority: 30 }),
      row({ id: "b", priority: 90 }),
      row({ id: "c", priority: 60, valid_until: new Date(NOW - 1000).toISOString() }),
      row({ id: "d", priority: 60 }),
    ];
    expect(selectReadable(rows, NOW, 2).map((i) => i.id)).toEqual(["b", "d"]);
  });
  it("eşleme: geçersiz kanıt satırları ve tehlikeli href elenir/düzeltilir", () => {
    const i = mapInsightRow(row({ href: "https://evil.example" }));
    expect(i.href).toBe("/app");
    expect(i.evidence).toEqual([{ label: "a", value: "b", href: "/app/x" }]);
    expect(i.isForecast).toBe(true);
    expect(i.narrative).toBeNull();
  });
});
