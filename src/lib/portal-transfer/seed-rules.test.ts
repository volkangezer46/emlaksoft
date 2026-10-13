import { describe, expect, it } from "vitest";
import { FIELD_RULES, FILL_FIELD_KEYS, PORTAL_FORM_RULES, REQUIRED_FIELDS, TRANSFER_PORTALS } from "./rules";
import { SEED_RULE_SETS, seedRuleSet } from "./seed-rules";
import { validateRuleSet } from "./rule-format";

describe("tohum kural seti", () => {
  it.each(TRANSFER_PORTALS)("%s: biçim-1 doğrulayıcısından geçer (version 0 yalnız tohum)", (portal) => {
    const s = seedRuleSet(portal);
    const r = validateRuleSet(s, { allowSeed: true, portal, extensionVersion: "0.6.0" });
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    expect(validateRuleSet(s).ok).toBe(false);
    expect(s.version).toBe(0);
    expect(SEED_RULE_SETS[portal]).toEqual(s);
  });

  it("tüm FILL_FIELD_KEYS'i kapsar; rules.ts ile birebir; her alan unverified, çapa/seçenek/parmak izi yok", () => {
    const s = seedRuleSet("sahibinden");
    expect(s.fields.map((f) => f.key).sort()).toEqual([...FILL_FIELD_KEYS].sort());
    for (const rule of FIELD_RULES) {
      const f = s.fields.find((x) => x.key === rule.key)!;
      expect(f.labels).toEqual([...rule.labels]);
      expect(f.exact).toEqual([...(rule.exact ?? [])]);
      expect(f.control).toBe(rule.control);
      expect(f).toMatchObject({ state: "unverified", confidence: 0, anchors: [], options: {} });
    }
    expect(s.fingerprints).toEqual([]);
    expect(s.form.required).toEqual([...REQUIRED_FIELDS]);
    expect(s.form.maxPhotos).toBe(PORTAL_FORM_RULES.sahibinden.maxPhotos);
  });

  it("her çağrı yeni nesne döner (paylaşılan durum yok)", () => {
    const a = seedRuleSet("hepsiemlak");
    a.fields[0]!.labels.push("degisti");
    expect(seedRuleSet("hepsiemlak").fields[0]!.labels).not.toContain("degisti");
  });
});
