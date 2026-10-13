import { describe, expect, it } from "vitest";
import { planFill, type ControlDescriptor } from "./fill-plan";
import { buildPortalPayload, type PortalPayload, type PortalPropertyInput } from "./payload";
import type { RuleField, RuleSet } from "./rule-format";
import { matchedCount, pickPlan, resolveRules } from "./rules-engine";
import { seedRuleSet } from "./seed-rules";

/**
 * Kural motoru: depodaki set ikinci kez doğrulanır (geçmezse tohum), uzak set tohumdan belirgin az eşleşirse tohum seçilir,
 * kapalı alan elle listesine düşer, çapa etiketin önüne geçer, seçenek takma adı sezgisel eşlemeden önce denenir. Güvenlik
 * tabanı (yer tutucu, dolu alan, riskli alan) veriyle gevşemez.
 */

const NOW = Date.parse("2026-10-14T00:00:00Z");
const property: PortalPropertyInput = {
  id: "p",
  propertyCode: "ES-1",
  title: "Moda 3+1",
  transactionType: "Satılık",
  propertyType: "Daire",
  listPrice: 6_000_000,
  provinceName: null,
  districtName: "Kadıköy",
  neighborhoodName: null,
  addressLine: null,
  features: { rooms: "3+1", sqm: 120, heating: "Merkezi", description: "Açıklama", bathrooms: 1 },
  parcelBlock: null,
  parcelLot: null,
  swapOk: null,
  eidsPropertyNo: "ABC-123456",
  authorityDocNo: null,
  authorityEidsStatus: null,
  authorizationStart: null,
  authorizationEnd: null,
  deedStatus: null,
  photos: [],
};
const base = buildPortalPayload(property, "sahibinden", NOW);
const payload = (fields: PortalPayload["fields"]): PortalPayload => ({ ...base, fields: { ...base.fields, ...fields } });

function d(p: Partial<ControlDescriptor> & { idx: number; labels: string[] }): ControlDescriptor {
  return { tag: "input", type: "text", options: [], current: "", checked: false, group: "", optionText: "", disabled: false, visible: true, ...p };
}

function remote(patch: (f: RuleField) => RuleField = (f) => f, extra: Partial<RuleSet> = {}): RuleSet {
  const s = seedRuleSet("sahibinden");
  return { ...s, version: 7, issuedAt: "2026-10-13T00:00:00Z", expiresAt: "2026-10-27T00:00:00Z", minExtension: "0.6.0", fields: s.fields.map((f) => patch({ ...f })), ...extra };
}

const FORM = [
  d({ idx: 0, labels: ["İlan Başlığı"] }),
  d({ idx: 1, labels: ["Fiyat"], type: "number" }),
  d({ idx: 2, labels: ["m² (Brüt)"] }),
  d({ idx: 3, tag: "textarea", type: "", labels: ["Açıklama"] }),
  d({ idx: 4, tag: "select", type: "", labels: ["Oda Sayısı"], options: ["Seçiniz", "2+1", "3+1"], current: "Seçiniz" }),
  d({ idx: 5, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Doğalgaz Sobası", "Kombi (Doğalgaz)", "Merkezi"], current: "Seçiniz" }),
];

describe("rules-engine: resolveRules", () => {
  const seed = seedRuleSet("sahibinden");
  it("depo boş → tohum; şemadan geçmeyen (bilinmeyen anahtar) → tohum; süresi dolmuş → tohum; geçerli → uzak", () => {
    expect(resolveRules(null, seed).source).toBe("seed");
    expect(resolveRules({ ...remote(), evil: "x" }, seed, { nowMs: NOW })).toMatchObject({ source: "seed" });
    expect(resolveRules({ ...remote(), version: 0 }, seed, { nowMs: NOW }).source).toBe("seed");
    expect(resolveRules({ ...remote(), portal: "emlakjet" }, seed, { nowMs: NOW }).source).toBe("seed");
    expect(resolveRules(remote(), seed, { nowMs: Date.parse("2026-11-01T00:00:00Z") })).toMatchObject({ source: "seed", reason: "expired" });
    expect(resolveRules(remote((f) => ({ ...f, labels: [...f.labels, "<script>"] })), seed, { nowMs: NOW }).source).toBe("seed");
    const ok = resolveRules(remote(), seed, { nowMs: NOW, installedVersion: "0.6.0" });
    expect(ok.source).toBe("remote");
    expect(ok.set.version).toBe(7);
    expect(resolveRules(remote(), seed, { nowMs: NOW, installedVersion: "0.5.0" }).source).toBe("seed"); // minExtension > kurulu
  });
});

describe("rules-engine: planFill + pickPlan", () => {
  const p = payload({ heating: "Doğalgaz" });

  it("varsayılan parametre tohumdur: mevcut çağrı ile tohumla çağrı aynı planı verir", () => {
    const a = planFill(FORM, p);
    const b = planFill(FORM, p, seedRuleSet("sahibinden"));
    expect(a.actions).toEqual(b.actions);
    expect(a.ruleVersion).toBe(0);
    expect(a.ruleSha).toBeNull();
  });

  it("uzak set tohumdan 3+ az eşleşirse tohum planı seçilir ve rulesRegressed işaretlenir", () => {
    const poor = remote((f) => (["title", "price", "gross_sqm", "description"].includes(f.key) ? { ...f, labels: ["zzz yok"], exact: [] } : f));
    const seedPlan = planFill(FORM, p);
    const remotePlan = planFill(FORM, p, poor, { ruleSha: "a".repeat(64) });
    expect(matchedCount(seedPlan) - matchedCount(remotePlan)).toBeGreaterThanOrEqual(3);
    const chosen = pickPlan(remotePlan, seedPlan);
    expect(chosen.rulesRegressed).toBe(true);
    expect(chosen.ruleVersion).toBe(0);
    // 2 eksik eşleşme eşiği aşmaz: uzak plan kalır.
    const slight = planFill(FORM, p, remote((f) => (["title", "gross_sqm"].includes(f.key) ? { ...f, labels: ["zzz yok"], exact: [] } : f)), { ruleSha: "b".repeat(64) });
    const kept = pickPlan(slight, seedPlan);
    expect(kept.rulesRegressed).toBe(false);
    expect(kept.ruleVersion).toBe(7);
    expect(kept.ruleSha).toBe("b".repeat(16));
  });

  it("disabled alan doldurulmaz, 'manual' (elle doldurun) olur ve denetimi tüketmez", () => {
    const plan = planFill(FORM, p, remote((f) => (f.key === "heating" ? { ...f, state: "disabled" } : f)));
    expect(plan.actions.find((a) => a.field === "heating")).toBeUndefined();
    expect(plan.report.find((r) => r.key === "heating")).toMatchObject({ status: "manual", state: "disabled" });
    expect(plan.manual.join("|")).toMatch(/Isıtma: Doğalgaz/);
    expect(plan.unclaimed).toContain(5);
  });

  it("çapa (alan imzası) etiketin önüne geçer; sayfada tekil değilse kullanılmaz", () => {
    const form = [
      d({ idx: 0, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Merkezi"], current: "Seçiniz" }),
      d({ idx: 1, tag: "select", type: "", labels: ["Yakıt tipi"], options: ["Seçiniz", "Merkezi"], current: "Seçiniz" }),
    ];
    const rules = remote((f) => (f.key === "heating" ? { ...f, anchors: ["bbbbbbbbbbbbbbbb"] } : f));
    const pm = payload({ heating: "Merkezi" });
    const anchored = planFill(form, pm, rules, { anchors: new Map([[0, "aaaaaaaaaaaaaaaa"], [1, "bbbbbbbbbbbbbbbb"]]) });
    expect(anchored.actions).toContainEqual({ idx: 1, op: "select", field: "heating", optionIndex: 1 });
    expect(anchored.report.find((r) => r.key === "heating")).toMatchObject({ idx: 1, anchorHit: true });
    const dup = planFill(form, pm, rules, { anchors: new Map([[0, "bbbbbbbbbbbbbbbb"], [1, "bbbbbbbbbbbbbbbb"]]) });
    expect(dup.actions).toContainEqual({ idx: 0, op: "select", field: "heating", optionIndex: 1 }); // etikete döner
  });

  it("seçenek takma adı: 'Doğalgaz' → 'Kombi (Doğalgaz)' (sezgisel eşleme 'Doğalgaz Sobası' seçerdi)", () => {
    expect(planFill(FORM, p).actions).toContainEqual({ idx: 5, op: "select", field: "heating", optionIndex: 1 });
    const rules = remote((f) => (f.key === "heating" ? { ...f, options: { dogalgaz: ["kombi dogalgaz"] } } : f));
    expect(planFill(FORM, p, rules).actions).toContainEqual({ idx: 5, op: "select", field: "heating", optionIndex: 2 });
  });

  it("evet/hayır yönünü ters çeviren takma ad yok sayılır; setin yer tutucusu seçilmez", () => {
    const form = [d({ idx: 0, tag: "select", type: "", labels: ["Asansör"], options: ["Belirtilmemiş", "Yok", "Var"], current: "Belirtilmemiş" })];
    const evil = remote((f) => (f.key === "elevator" ? { ...f, options: { evet: ["yok"] } } : f), { placeholders: ["belirtilmemis"] });
    const plan = planFill(form, payload({ elevator: true }), evil);
    expect(plan.actions).toContainEqual({ idx: 0, op: "select", field: "elevator", optionIndex: 2 });
  });

  it("riskli alan (fiyat) uzak sette geriletilmişse doldurulmaz; doğrulanmamış tohum etiketiyle dolar", () => {
    const degraded = planFill(FORM, p, remote((f) => (f.key === "price" ? { ...f, state: "degraded" } : f)));
    expect(degraded.actions.find((a) => a.field === "price")).toBeUndefined();
    expect(degraded.report.find((r) => r.key === "price")).toMatchObject({ status: "manual", idx: 1 });
    const plain = planFill(FORM, p, remote());
    expect(plain.actions.find((a) => a.field === "price")).toMatchObject({ idx: 1, op: "text" });
    // Isıtma geriletilmişse yine doldurulur ama rapor "degraded" (kontrol edin) taşır.
    const heat = planFill(FORM, p, remote((f) => (f.key === "heating" ? { ...f, state: "degraded" } : f)));
    expect(heat.report.find((r) => r.key === "heating")).toMatchObject({ status: "planned", state: "degraded" });
  });

  it("kaynak kilidi: uzak veri yalnız katlanmış eşitlik/sözcük karşılaştırmasında kullanılır (RegExp, seçici, kod yok)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["fill-plan.ts", "rules-engine.ts", "rules-store.ts", "rules-verify.ts", "correction.ts", "form-signature.ts", "feedback-build.ts"]) {
      const src = readFileSync(`src/lib/portal-transfer/${f}`, "utf8");
      expect(src, f).not.toMatch(/new RegExp\(|querySelector|setAttribute|new Function|eval\(|innerHTML|fetch\(/);
    }
  });

  it("uzak ve tohum aynı alanı farklı denetime atıyorsa uzak plandaki alan 'kontrol edin' olur", () => {
    const form = [...FORM, d({ idx: 6, labels: ["Başlık metni"] })];
    const rules = remote((f) => (f.key === "title" ? { ...f, labels: ["baslik metni"], state: "verified" } : f));
    const chosen = pickPlan(planFill(form, p, rules), planFill(form, p));
    expect(chosen.report.find((r) => r.key === "title")).toMatchObject({ idx: 6, state: "degraded" });
  });
});

describe("rules-engine: pickPlan uzak setin elle kararlarını korur", () => {
  const p = payload({ heating: "Doğalgaz" });
  const seedPlan = planFill(FORM, p);

  it("3 alan 'disabled' → karşılaştırmaya girmez: tohuma dönülmez, kapatılan alanlar doldurulmaz", () => {
    const off = ["title", "gross_sqm", "rooms"];
    const plan = planFill(FORM, p, remote((f) => (off.includes(f.key) ? { ...f, state: "disabled" } : f)), { ruleSha: "c".repeat(64) });
    const chosen = pickPlan(plan, seedPlan);
    expect(chosen.rulesRegressed).toBe(false);
    expect(chosen.ruleVersion).toBe(7);
    for (const k of off) {
      expect(chosen.actions.find((a) => a.field === k), k).toBeUndefined();
      expect(chosen.report.find((r) => r.key === k), k).toMatchObject({ status: "manual", state: "disabled" });
    }
  });

  it("riskli alan geriletilmiş + diğer alanlarda gerçek gerileme → tohuma dönülür AMA riskli/kapalı alanlar yine elle kalır", () => {
    const poor = remote((f) => {
      if (f.key === "price") return { ...f, state: "degraded" };
      if (f.key === "rooms") return { ...f, state: "disabled" };
      if (["title", "gross_sqm", "description"].includes(f.key)) return { ...f, labels: ["zzz yok"], exact: [] };
      return f;
    });
    const chosen = pickPlan(planFill(FORM, p, poor, { ruleSha: "d".repeat(64) }), seedPlan);
    expect(chosen.rulesRegressed).toBe(true);
    expect(chosen.ruleVersion).toBe(0);
    expect(chosen.actions.find((a) => a.field === "price")).toBeUndefined();
    expect(chosen.actions.find((a) => a.field === "rooms")).toBeUndefined();
    expect(chosen.report.find((r) => r.key === "price")).toMatchObject({ status: "manual" });
    expect(chosen.report.find((r) => r.key === "rooms")).toMatchObject({ status: "manual", state: "disabled" });
    expect(chosen.manual.join("|")).toMatch(/Oda/);
    // Tohumun bulduğu diğer alanlar doldurulur.
    expect(chosen.actions.find((a) => a.field === "title")).toMatchObject({ idx: 0, op: "text" });
  });
});
