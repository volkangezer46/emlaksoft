import { describe, expect, it } from "vitest";
import { applyProposals, restamp, stampFor, verifiedRemovals, type RuleProposal } from "./rule-apply";
import { seedRuleSet } from "./seed-rules";
import { validateRuleSet, type RuleSet } from "./rule-format";

const NOW = Date.parse("2026-10-13T00:00:00Z");
const base = (): RuleSet => restamp(seedRuleSet("sahibinden"), stampFor(4, NOW, 14));
const p = (over: Partial<RuleProposal>): RuleProposal => ({ id: "p", kind: "label_map", field_key: "heating", source: "corrections", proposal: {}, ...over });

describe("applyProposals", () => {
  it("label_map etiket/çapa ekler, ofis oylu eşleme alanı doğrular; sonuç doğrulayıcıdan geçer", () => {
    const r = applyProposals(base(), [p({ proposal: { label: "yakit tipi", anchor: "0123456789abcdef" }, confidence: 0.596 })], { stamp: stampFor(5, NOW, 14) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = r.content.fields.find((x) => x.key === "heating")!;
    expect(f.labels).toContain("yakit tipi");
    expect(f.anchors).toEqual(["0123456789abcdef"]);
    expect(f).toMatchObject({ state: "verified", confidence: 0.596 });
    expect(r.content.version).toBe(5);
    expect(r.changeSummary.count).toBe(1);
    expect(validateRuleSet(r.content).ok).toBe(true);
  });

  it("option_map takma ad ekler; AI önerisi alanı doğrulamaz (unverified)", () => {
    const r = applyProposals(base(), [
      p({ kind: "option_map", proposal: { value: "dogalgaz", alias: "kombi dogalgaz" } }),
      p({ id: "ai", source: "ai", field_key: "facade", proposal: { label: "bakis yonu" } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.fields.find((x) => x.key === "heating")!.options).toEqual({ dogalgaz: ["kombi dogalgaz"] });
    expect(r.content.fields.find((x) => x.key === "facade")!.state).toBe("unverified");
  });

  it("field_demote → degraded; field_disable yalnız personel kaynaklı", () => {
    const ok = applyProposals(base(), [p({ kind: "field_demote", field_key: "rooms" }), p({ kind: "field_disable", field_key: "dues", source: "staff" })]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.content.fields.find((x) => x.key === "rooms")!.state).toBe("degraded");
      expect(ok.content.fields.find((x) => x.key === "dues")!.state).toBe("disabled");
    }
    expect(applyProposals(base(), [p({ kind: "field_disable", field_key: "dues", source: "corrections" })])).toMatchObject({ ok: false, reason: "disable_requires_staff" });
  });

  it("5'ten fazla değişikliği reddeder", () => {
    const many = Array.from({ length: 6 }, (_, i) => p({ id: `p${i}`, kind: "field_demote", field_key: (["rooms", "floor", "dues", "facade", "heating", "elevator"] as const)[i]! }));
    expect(applyProposals(base(), many)).toMatchObject({ ok: false, reason: "too_many_changes" });
    expect(applyProposals(base(), many.slice(0, 5)).ok).toBe(true);
  });

  it("doğrulanmış alandan silmez: verifiedRemovals silmeyi yakalar; geçersiz sonuç hata döner", () => {
    const b = base();
    const heating = b.fields.find((x) => x.key === "heating")!;
    heating.state = "verified";
    heating.anchors = ["0123456789abcdef"];
    const next = JSON.parse(JSON.stringify(b)) as RuleSet;
    next.fields.find((x) => x.key === "heating")!.anchors = [];
    expect(verifiedRemovals(b, next)).toEqual(["heating:capa:0123456789abcdef"]);
    // apply hiçbir zaman silmez: doğrulanmış alana ek yapılır, eskiler korunur
    const r = applyProposals(b, [p({ proposal: { anchor: "fedcba9876543210" } })]);
    expect(r.ok && r.content.fields.find((x) => x.key === "heating")!.anchors).toEqual(["0123456789abcdef", "fedcba9876543210"]);
    // başka anahtarın tohum etiketini taşımaya çalışan öneri doğrulayıcıda düşer
    expect(applyProposals(b, [p({ proposal: { label: "brut alan" } })])).toMatchObject({ ok: false, reason: expect.stringMatching(/^invalid_result:label_(moved|shared)/) });
  });

  it("riskli anahtara ofis/AI eşlemesi eklenemez", () => {
    expect(applyProposals(base(), [p({ field_key: "price", proposal: { label: "satis bedeli" } })])).toMatchObject({ ok: false, reason: "risky_key" });
  });
});
