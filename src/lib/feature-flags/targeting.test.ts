import { describe, expect, it } from "vitest";
import { describeFlagRule, evaluateTargeted, flagBucket, ruleInWindow, ruleMatchesTarget, validateFlagRuleInput, type FlagRule } from "./targeting";

const NOW = Date.parse("2026-10-14T09:00:00.000Z");

/** Deterministik sahte ofis kimlikleri (rastgelelik yok: test her koşuda aynı). */
function tenantId(i: number): string {
  const hex = (i * 2654435761 >>> 0).toString(16).padStart(8, "0");
  const tail = i.toString(16).padStart(12, "0");
  return `${hex}-0000-4000-8000-${tail}`;
}

const rule = (over: Partial<FlagRule> = {}): FlagRule => ({
  flagKey: "feature_board",
  tenantIds: [],
  plans: [],
  percentage: 10,
  startsAt: null,
  endsAt: null,
  ...over,
});

describe("özellik bayrağı hedefleme: yüzde kovası", () => {
  it("%10 açılan bayrak aynı ofiste her değerlendirmede aynı sonucu verir (kararlı)", () => {
    const r = rule({ percentage: 10 });
    for (let i = 0; i < 500; i++) {
      const target = { tenantId: tenantId(i), plan: "office" };
      const first = evaluateTargeted({ globalOn: true, rule: r, target, nowMs: NOW });
      for (let k = 0; k < 5; k++) {
        expect(evaluateTargeted({ globalOn: true, rule: { ...r }, target: { ...target }, nowMs: NOW + k * 3_600_000 })).toBe(first);
      }
      // Büyük/küçük harf farkı aynı ofistir.
      expect(evaluateTargeted({ globalOn: true, rule: r, target: { ...target, tenantId: target.tenantId.toUpperCase() }, nowMs: NOW })).toBe(first);
    }
  });

  it("kova 0-99 aralığında, aynı girdi aynı kova; %10 yaklaşık onda bir ofise açılır", () => {
    let on = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const b = flagBucket("feature_board", tenantId(i));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
      expect(flagBucket("feature_board", tenantId(i))).toBe(b);
      if (ruleMatchesTarget(rule({ percentage: 10 }), { tenantId: tenantId(i), plan: null }, NOW)) on++;
    }
    expect(on / N).toBeGreaterThan(0.07);
    expect(on / N).toBeLessThan(0.13);
  });

  it("yüzde büyütülünce önceden açık ofisler açık kalır; farklı bayraklar bağımsız dağılır", () => {
    let differs = 0;
    for (let i = 0; i < 300; i++) {
      const target = { tenantId: tenantId(i), plan: null };
      if (ruleMatchesTarget(rule({ percentage: 10 }), target, NOW)) expect(ruleMatchesTarget(rule({ percentage: 25 }), target, NOW)).toBe(true);
      if (flagBucket("nps_survey", target.tenantId) !== flagBucket("feature_board", target.tenantId)) differs++;
    }
    expect(differs).toBeGreaterThan(250);
  });

  it("%0 kimseye, %100 herkese (plan süzgeci içinde) açar", () => {
    for (let i = 0; i < 100; i++) {
      expect(ruleMatchesTarget(rule({ percentage: 0 }), { tenantId: tenantId(i), plan: null }, NOW)).toBe(false);
      expect(ruleMatchesTarget(rule({ percentage: 100 }), { tenantId: tenantId(i), plan: null }, NOW)).toBe(true);
    }
  });
});

describe("özellik bayrağı hedefleme: ofis, plan ve zaman", () => {
  const pilot = tenantId(7);

  it("ofis listesindeki ofis plan ve yüzdeden bağımsız açıktır", () => {
    const r = rule({ tenantIds: [pilot], plans: ["enterprise"], percentage: 0 });
    expect(ruleMatchesTarget(r, { tenantId: pilot, plan: "advisor" }, NOW)).toBe(true);
    expect(ruleMatchesTarget(r, { tenantId: tenantId(8), plan: "enterprise" }, NOW)).toBe(false);
  });

  it("plan süzgeci: yalnız seçili plandaki ofisler yüzdeye girer", () => {
    const r = rule({ plans: ["professional"], percentage: 100 });
    expect(ruleMatchesTarget(r, { tenantId: tenantId(1), plan: "professional" }, NOW)).toBe(true);
    expect(ruleMatchesTarget(r, { tenantId: tenantId(1), plan: "office" }, NOW)).toBe(false);
    expect(ruleMatchesTarget(r, { tenantId: tenantId(1), plan: null }, NOW)).toBe(false);
  });

  it("zaman penceresi: başlangıç dahil, bitiş hariç; pencere dışında ofis listesi de kapalı", () => {
    const r = rule({ tenantIds: [pilot], percentage: 0, startsAt: "2026-10-14T09:00:00.000Z", endsAt: "2026-10-15T09:00:00.000Z" });
    expect(ruleInWindow(r, NOW)).toBe(true);
    expect(ruleInWindow(r, NOW - 1)).toBe(false);
    expect(ruleInWindow(r, Date.parse("2026-10-15T09:00:00.000Z"))).toBe(false);
    expect(ruleMatchesTarget(r, { tenantId: pilot, plan: null }, NOW - 1)).toBe(false);
  });

  it("genel anahtar kapalıysa kural etkisiz (kapalı); kural yoksa genel durum geçerli", () => {
    const target = { tenantId: pilot, plan: null };
    expect(evaluateTargeted({ globalOn: false, rule: rule({ tenantIds: [pilot] }), target, nowMs: NOW })).toBe(false);
    expect(evaluateTargeted({ globalOn: true, rule: null, target, nowMs: NOW })).toBe(true);
    expect(evaluateTargeted({ globalOn: false, rule: null, target, nowMs: NOW })).toBe(false);
  });

  it("özet metni ofis, plan, yüzde ve pencereyi söyler", () => {
    const text = describeFlagRule(rule({ tenantIds: [pilot], plans: ["professional"], percentage: 10, endsAt: "2026-10-20T00:00:00.000Z" }), () => "20.10.2026");
    expect(text).toBe("1 seçili ofis · Profesyonel planında %10 · şimdi – 20.10.2026");
  });
});

describe("hedefleme kuralı doğrulama", () => {
  const base = { tenantIds: [] as string[], plans: [] as string[], percentage: 10, startsAt: null, endsAt: null, note: null };

  it("boş hedef, yüzdesiz plan ve ters pencere reddedilir", () => {
    expect(validateFlagRuleInput({ ...base, percentage: 0 }).ok).toBe(false);
    expect(validateFlagRuleInput({ ...base, plans: ["office"], percentage: 0, tenantIds: [tenantId(1)] }).ok).toBe(false);
    expect(validateFlagRuleInput({ ...base, startsAt: "2026-10-15T00:00:00.000Z", endsAt: "2026-10-14T00:00:00.000Z" }).ok).toBe(false);
    expect(validateFlagRuleInput({ ...base, percentage: 101 }).ok).toBe(false);
    expect(validateFlagRuleInput({ ...base, plans: ["gold"] }).ok).toBe(false);
  });

  it("geçerli girdi: yinelenen ofis/plan tekilleşir", () => {
    const r = validateFlagRuleInput({ ...base, tenantIds: [tenantId(1), tenantId(1).toUpperCase()], plans: ["office", "office"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tenantIds).toHaveLength(1);
      expect(r.value.plans).toEqual(["office"]);
    }
  });
});
