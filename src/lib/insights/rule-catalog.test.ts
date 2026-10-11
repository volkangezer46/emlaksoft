import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock, type RecordedQuery } from "../../test/supabase-mock";
import { processTenant } from "@/lib/insights/engine";
import { INSIGHT_RULES, type InsightRule } from "@/lib/insights/rules";
import { aggregateRuleQuality, countClosedRules, listInsightRuleCatalog, loadAutoMutedRuleBases, ruleSwitchState } from "@/lib/insights/rule-catalog";
import { isQualityReopened, normalizeInsightSettings } from "@/lib/insights/settings";
import { DEFAULT_INSIGHT_SETTINGS, type InsightSettings } from "@/lib/insights/types";

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const settings = (over: Partial<InsightSettings> = {}): InsightSettings => ({ ...DEFAULT_INSIGHT_SETTINGS, ...over });

describe("kural kataloğu (Türkçe adlar kayıt listesinden)", () => {
  it("her kural kaydının Türkçe adı var ve benzersiz", () => {
    const labels = INSIGHT_RULES.map((r) => r.label);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(5);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("katalog kayıt listesi + günlük özetten oluşur", async () => {
    const cat = await listInsightRuleCatalog();
    expect(cat).toHaveLength(INSIGHT_RULES.length + 1);
    expect(cat.some((c) => c.id === "digest@1")).toBe(true);
    expect(cat.every((c) => c.base === c.id.split("@")[0])).toBe(true);
  });
});

describe("ruleSwitchState / sayım (saf)", () => {
  const auto = new Set(["deal_risk"]);
  it("açık, elle kapalı, otomatik sessiz", () => {
    expect(ruleSwitchState(settings(), auto, "call_priority@1")).toBe("on");
    expect(ruleSwitchState(settings({ mutedRules: ["call_priority"] }), auto, "call_priority@1")).toBe("off");
    expect(ruleSwitchState(settings(), auto, "deal_risk@1")).toBe("auto");
  });
  it("yeniden açılan kural otomatik sessiz sayılmaz; elle kapatma her zaman önce gelir", () => {
    expect(ruleSwitchState(settings({ qualityReopened: ["deal_risk"] }), auto, "deal_risk@1")).toBe("on");
    expect(ruleSwitchState(settings({ qualityReopened: ["deal_risk"], mutedRules: ["deal_risk"] }), auto, "deal_risk@1")).toBe("off");
  });
  it("kapalı kural sayısı elle + otomatiği toplar", () => {
    expect(countClosedRules(["on", "off", "auto", "on"])).toBe(2);
  });
});

describe("qualityReopened ayarı", () => {
  it("boşsa alan yazılmaz (varsayılan biçim değişmez); doluysa temiz taban adlar", () => {
    expect(normalizeInsightSettings(undefined)).toEqual(DEFAULT_INSIGHT_SETTINGS);
    expect(normalizeInsightSettings({ mutedRules: [] })).not.toHaveProperty("qualityReopened");
    const s = normalizeInsightSettings({ qualityReopened: ["deal_risk@1", "deal_risk", "DROP TABLE", 4] });
    expect(s.qualityReopened).toEqual(["deal_risk"]);
    expect(isQualityReopened(s, "deal_risk@1")).toBe(true);
    expect(isQualityReopened(s, "price_action@1")).toBe(false);
  });
  it("AI anlatımı varsayılan KAPALI", () => {
    expect(DEFAULT_INSIGHT_SETTINGS.narrativeEnabled).toBe(false);
    expect(normalizeInsightSettings({}).narrativeEnabled).toBe(false);
  });
});

describe("kalite toplama (insight_rule_quality ile aynı tanım)", () => {
  it("kabul/yoksay/yanlış sayılır; eşik motorla aynı (>=10 değerlendirme, >%40 yanlış)", async () => {
    const rows = [
      ...Array.from({ length: 2 }, () => ({ rule_id: "deal_risk@1", state: "accepted", state_reason: null })),
      ...Array.from({ length: 8 }, () => ({ rule_id: "deal_risk@1", state: "dismissed", state_reason: "yanlis" })),
      ...Array.from({ length: 2 }, () => ({ rule_id: "deal_risk@1", state: "dismissed", state_reason: "sonra" })),
      ...Array.from({ length: 3 }, () => ({ rule_id: "call_priority@1", state: "dismissed", state_reason: "yanlis" })),
    ];
    expect(aggregateRuleQuality(rows).find((r) => r.ruleId === "deal_risk@1")).toEqual({ ruleId: "deal_risk@1", accepted: 2, dismissed: 10, dismissedWrong: 8 });
    const mock = createSupabaseMock((q) => (q.table === "insights" ? { data: rows } : undefined));
    const bases = await loadAutoMutedRuleBases(mock.client as unknown as SupabaseClient, "t1", NOW);
    expect([...bases]).toEqual(["deal_risk"]); // call_priority yalnız 3 değerlendirme: bastırılmaz
  });

  it("okunamazsa boş küme (yanlış rozet yok)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = createSupabaseMock(() => ({ error: { code: "XX000", message: "x" } }));
    expect((await loadAutoMutedRuleBases(mock.client as unknown as SupabaseClient, "t1", NOW)).size).toBe(0);
    spy.mockRestore();
  });
});

describe("motor: yeniden açılan kural kalite bastırmasından muaf", () => {
  const noisy = [{ rule_id: "call_priority@1", accepted: 2, dismissed: 10, dismissed_wrong: 8 }];
  function admin(insightsSettings: Record<string, unknown>) {
    const mock = createSupabaseMock((q: RecordedQuery) => {
      if (q.table === "customers" || q.table === "properties") return { count: 9, data: [] };
      if (q.table === "profiles") return { data: [{ id: "11111111-1111-4111-8111-111111111111", role: "advisor" }] };
      if (q.table === "oversight_settings") return { data: { thresholds: { insights: insightsSettings } } };
      if (q.table === "insight_rule_quality") return { data: noisy };
      return { data: [] };
    });
    return mock.client as unknown as SupabaseClient;
  }
  const mk = (run: InsightRule["run"]): InsightRule => ({ id: "call_priority@1", kind: "call_priority", label: "Test", run });

  it("yeniden açılmamış: bastırılır; açılmış: koşar", async () => {
    const run = vi.fn(async () => []);
    const r1 = await processTenant(admin({}), "t1", NOW, { rules: [mk(run)] });
    expect(run).not.toHaveBeenCalled();
    expect(r1.rulesMuted).toBe(1);
    const r2 = await processTenant(admin({ qualityReopened: ["call_priority"] }), "t1", NOW, { rules: [mk(run)] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(r2.rulesMuted).toBe(0);
  });

  it("yeniden açılsa bile elle kapatılmış kural koşmaz", async () => {
    const run = vi.fn(async () => []);
    const r = await processTenant(admin({ qualityReopened: ["call_priority"], mutedRules: ["call_priority"] }), "t1", NOW, { rules: [mk(run)] });
    expect(run).not.toHaveBeenCalled();
    expect(r.rulesMuted).toBe(1);
  });
});
