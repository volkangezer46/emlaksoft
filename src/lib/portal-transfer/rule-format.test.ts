import { describe, expect, it } from "vitest";
import { canonicalJson, compareVersions, isRuleSetExpired, ruleSetSha256, signedMessage, validateRuleSet, type RuleSet } from "./rule-format";
import { seedRuleSet } from "./seed-rules";
import { restamp, stampFor } from "./rule-apply";

const NOW = Date.parse("2026-10-13T00:00:00Z");
const remote = (version = 3): RuleSet => restamp(seedRuleSet("sahibinden"), stampFor(version, NOW, 14));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const reason = (raw: unknown, opts = {}) => {
  const r = validateRuleSet(raw, opts);
  return r.ok ? "ok" : r.reason;
};

describe("kural seti biçimi 1 — validateRuleSet", () => {
  it("geçerli uzak set ve tohum (yalnız allowSeed ile) geçer; dönen set kopyadır", () => {
    const s = remote();
    const r = validateRuleSet(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.set).toEqual(s);
      expect(r.set).not.toBe(s);
    }
    expect(reason(seedRuleSet("emlakjet"))).toBe("seed_version");
    expect(reason(seedRuleSet("emlakjet"), { allowSeed: true })).toBe("ok");
  });

  it("bilinmeyen anahtar her düzeyde reddedilir (kök, form, alan)", () => {
    expect(reason({ ...remote(), regex: "x" })).toMatch(/^root_key_set/);
    const f = clone(remote());
    (f.form as Record<string, unknown>).selector = "#a";
    expect(reason(f)).toMatch(/^form_key_set/);
    const g = clone(remote());
    (g.fields[0] as Record<string, unknown>).url = "https://x";
    expect(reason(g)).toMatch(/^field_key_set/);
    const h = clone(remote());
    delete (h as Partial<RuleSet>).expiresAt;
    expect(reason(h)).toMatch(/^root_key_set/);
  });

  it("katlanmamış etiket, kısa/harfsiz etiket, FILL_FIELD_KEYS dışı anahtar, yinelenen anahtar → ret", () => {
    const a = clone(remote());
    a.fields[0]!.labels.push("İlan Başlığı");
    expect(reason(a)).toMatch(/^field_label_text/);
    const b = clone(remote());
    b.fields[0]!.labels.push("no");
    expect(reason(b)).toMatch(/^field_label_text/);
    const c = clone(remote());
    c.fields[0]!.labels.push("123");
    expect(reason(c)).toMatch(/^field_label_text/);
    const d = clone(remote());
    (d.fields[0] as { key: string }).key = "owner_phone";
    expect(reason(d)).toBe("field_unknown_key");
    const e = clone(remote());
    e.fields.push(clone(e.fields[0]!));
    expect(reason(e)).toMatch(/^field_duplicate/);
    const f = clone(remote());
    f.form.required.push("owner_phone" as never);
    expect(reason(f)).toBe("form_required");
  });

  it("64 KB üstü (metin ya da nesne) reddedilir", () => {
    const big = clone(remote());
    const huge = { ...big, fingerprints: big.fingerprints, placeholders: big.placeholders };
    const raw = JSON.stringify(huge) + " ".repeat(70_000);
    expect(reason(raw)).toBe("too_large");
    const fat = clone(remote());
    for (const fl of fat.fields) for (let i = 0; i < 40; i++) fl.options[`secenek ${i} ${"x".repeat(40)}`] = ["a".repeat(60)];
    expect(reason(fat)).toBe("too_large");
  });

  it("version 0 tohum dışında reddedilir; sürüm tavanı; ömür ≤30 gün; minExtension kurulu sürümden büyük olamaz", () => {
    expect(reason(restamp(remote(), { version: 0, issuedAt: "2026-10-13T00:00:00Z", expiresAt: "2026-10-20T00:00:00Z" }))).toBe("seed_version");
    expect(reason({ ...remote(), version: 2 ** 31 })).toBe("version");
    expect(reason({ ...remote(), expiresAt: "2026-12-30T00:00:00Z" })).toBe("ttl_too_long");
    expect(reason({ ...remote(), expiresAt: "2026-10-12T00:00:00Z" })).toBe("expires_at");
    expect(reason({ ...remote(), minExtension: "0.7.0" }, { extensionVersion: "0.6.0" })).toBe("min_extension_newer");
    expect(reason({ ...remote(), minExtension: "0.6.0" }, { extensionVersion: "0.6.1" })).toBe("ok");
    expect(reason(remote(), { portal: "hepsiemlak" })).toBe("portal_mismatch");
  });

  it("Y5: aynı etiket iki anahtarda olamaz, tohum etiketi başka anahtara taşınamaz, denetim türü değişemez", () => {
    const a = clone(remote());
    a.fields.find((f) => f.key === "heating")!.labels.push("yakit tipi");
    a.fields.find((f) => f.key === "facade")!.labels.push("yakit tipi");
    expect(reason(a)).toMatch(/^label_shared/);
    const b = clone(remote());
    b.fields.find((f) => f.key === "net_sqm")!.labels.push("brut alan");
    expect(reason(b)).toMatch(/^label_shared/);
    // asıl sahibinden silinip başka anahtara taşınsa da reddedilir
    const gross = b.fields.find((f) => f.key === "gross_sqm")!;
    gross.labels = gross.labels.filter((l) => l !== "brut alan");
    expect(reason(b)).toMatch(/^label_moved/);
    const c = clone(remote());
    c.fields.find((f) => f.key === "heating")!.control = "text";
    expect(reason(c)).toMatch(/^field_control_mismatch/);
  });

  it("Y5: riskli anahtarlar uzak veriyle genişletilemez; evet/hayır yönü ters çevrilemez", () => {
    const a = clone(remote());
    a.fields.find((f) => f.key === "price")!.labels.push("tutar");
    expect(reason(a)).toMatch(/^field_risky_labels/);
    const b = clone(remote());
    b.fields.find((f) => f.key === "deed_status")!.options = { "kat mulkiyeti": ["kat irtifaki"] };
    expect(reason(b)).toMatch(/^field_risky_data/);
    const c = clone(remote());
    c.fields.find((f) => f.key === "balcony")!.options = { evet: ["yok"] };
    expect(reason(c)).toMatch(/^field_option_polarity/);
    const d = clone(remote());
    d.fields.find((f) => f.key === "balcony")!.options = { evet: ["var", "mevcut"] };
    expect(reason(d)).toBe("ok");
    // tohumda riskli alan etiketleri olduğu gibi durabilir
    expect(reason(seedRuleSet("sahibinden"), { allowSeed: true })).toBe("ok");
  });

  it("parmak izi ve çapa biçimi; yer tutucu katlanmış", () => {
    expect(reason({ ...remote(), fingerprints: ["abc"] })).toBe("fingerprint_text");
    const a = clone(remote());
    a.fields[0]!.anchors.push("XYZ");
    expect(reason(a)).toMatch(/^field_anchor_text/);
    expect(reason({ ...remote(), placeholders: ["Seçiniz"] })).toBe("placeholder_text");
    expect(reason({ ...remote(), placeholders: ["seciniz"] })).toBe("ok");
  });
});

describe("kanonik JSON, imzalanan ileti, sha", () => {
  it("anahtarlar sıralı, boşluksuz; dizi sırası korunur; sonlu olmayan sayı hata", () => {
    expect(canonicalJson({ b: 1, a: [3, 1, { d: 0.62, c: "x" }] })).toBe('{"a":[3,1,{"c":"x","d":0.62}],"b":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(signedMessage("sahibinden", 7, "ab")).toBe("es-rules|f1|sahibinden|7|ab");
  });

  it("sha anahtar sırasından bağımsız; Postgres'ten dönen 0.620 ayrıştırılınca aynı sha", async () => {
    const s = remote();
    s.fields[0]!.confidence = 0.62;
    const reordered = JSON.parse(JSON.stringify(s).replace('"confidence":0.62', '"confidence":0.620')) as RuleSet;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse());
    expect(await ruleSetSha256(shuffled)).toBe(await ruleSetSha256(s));
    expect(await ruleSetSha256(s)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("süre: tohum dolmaz, uzak set expiresAt'te dolar", () => {
    expect(isRuleSetExpired(seedRuleSet("sahibinden"), NOW + 1e12)).toBe(false);
    const s = remote();
    expect(isRuleSetExpired(s, NOW + 13 * 86_400_000)).toBe(false);
    expect(isRuleSetExpired(s, NOW + 14 * 86_400_000)).toBe(true);
    expect(compareVersions("0.10.0", "0.6.0")).toBe(1);
    expect(Number.isNaN(compareVersions("x", "0.6.0"))).toBe(true);
  });
});
