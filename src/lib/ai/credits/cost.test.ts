import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_TABLE,
  computeCredits,
  parseCostTable,
  quotaState,
  rateForModel,
} from "@/lib/ai/credits/cost";
import { featureLabel, quotaView, summarizeUsage } from "@/lib/ai/credits/aggregate";
import { trMonthKey, trMonthStartIso, trNextMonthStartIso } from "@/lib/clock";

describe("maliyet hesabi", () => {
  it("jetonu modele gore krediye cevirir ve 2 ondaliga yuvarlar", () => {
    // gpt-4o-mini: 1000 giris * 0.15 + 1000 cikis * 0.6 = 0.75
    expect(computeCredits("gpt-4o-mini", 1000, 1000)).toBe(0.75);
    expect(computeCredits("gpt-4o", 2000, 500)).toBe(10);
  });
  it("tarihli model adi en uzun onekle eslesir; bilinmeyen model fallback kullanir", () => {
    expect(rateForModel("gpt-4o-mini-2024-07-18", DEFAULT_COST_TABLE)).toEqual(DEFAULT_COST_TABLE.models["gpt-4o-mini"]);
    expect(rateForModel("yeni-model", DEFAULT_COST_TABLE)).toEqual(DEFAULT_COST_TABLE.fallback);
    expect(rateForModel(null, DEFAULT_COST_TABLE)).toEqual(DEFAULT_COST_TABLE.fallback);
  });
  it("cok kucuk cagri en az minCharge oder", () => {
    expect(computeCredits("gpt-4o-mini", 1, 1)).toBe(DEFAULT_COST_TABLE.minCharge);
  });
  it("admin ayari varsayilani ezer; bozuk ayar varsayilana duser", () => {
    const t = parseCostTable(JSON.stringify({ models: { "gpt-4o-mini": { in: 1, out: 2 } }, minCharge: 0.05 }));
    expect(computeCredits("gpt-4o-mini", 1000, 1000, t)).toBe(3);
    expect(t.minCharge).toBe(0.05);
    expect(t.models["gpt-4o"]).toEqual(DEFAULT_COST_TABLE.models["gpt-4o"]);
    expect(parseCostTable("{bozuk")).toEqual(DEFAULT_COST_TABLE);
    expect(parseCostTable(null)).toEqual(DEFAULT_COST_TABLE);
    expect(parseCostTable(JSON.stringify({ models: { x: { in: -1, out: "a" } } })).models.x).toBeUndefined();
  });
});

describe("kota durumu", () => {
  it("bos kota sinirsizdir", () => {
    expect(quotaState(99999, null)).toBe("unlimited");
    expect(quotaState(1, undefined)).toBe("unlimited");
    expect(quotaView(500, null)).toMatchObject({ remaining: null, percent: null, state: "unlimited" });
  });
  it("%80 uyari, kota ustu asim", () => {
    expect(quotaState(79, 100)).toBe("ok");
    expect(quotaState(80, 100)).toBe("warn");
    expect(quotaState(100, 100)).toBe("over");
    expect(quotaView(120, 100)).toMatchObject({ remaining: -20, percent: 120, state: "over" });
  });
});

describe("kullanim ozeti", () => {
  it("ozellik ve kullanici kirilimi toplar, buyukten kucuge siralar", () => {
    const s = summarizeUsage([
      { userId: "u1", feature: "tenant_chat", credits: 1, tokensIn: 100, tokensOut: 50 },
      { userId: "u2", feature: "tenant_chat", credits: 2, tokensIn: 10, tokensOut: 10 },
      { userId: null, feature: "briefing_summary", credits: 0.5, tokensIn: 0, tokensOut: 0 },
    ]);
    expect(s.used).toBe(3.5);
    expect(s.calls).toBe(3);
    expect(s.byFeature[0]).toMatchObject({ key: "tenant_chat", credits: 3, calls: 2 });
    expect(s.byUser.map((b) => b.key)).toEqual(["u2", "u1", "sistem"]);
    expect(featureLabel("tenant_chat")).toBe("AI asistan sohbeti");
  });
});

describe("TR ay siniri", () => {
  it("TR gece yarisi UTC+3: 31 Ocak 22:00 UTC zaten Subat'tir", () => {
    expect(trMonthKey("2026-01-31T20:59:59Z")).toBe("2026-01");
    expect(trMonthKey("2026-01-31T21:00:00Z")).toBe("2026-02");
  });
  it("ay baslangici ve sonraki ay baslangici TR saatine gore", () => {
    expect(trMonthStartIso("2026-03-15T12:00:00Z")).toBe("2026-02-28T21:00:00.000Z");
    expect(trNextMonthStartIso("2026-03-15T12:00:00Z")).toBe("2026-03-31T21:00:00.000Z");
    expect(trNextMonthStartIso("2026-12-10T12:00:00Z")).toBe("2026-12-31T21:00:00.000Z");
  });
});
