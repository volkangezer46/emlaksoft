import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, signedMessage, type RuleSet } from "./rule-format";
import { seedRuleSet } from "./seed-rules";
import { applyRulesResponse, decideAccept, rulesRefreshDue, EMPTY_RULES_META, type StoredRules } from "./rules-store";
import { sha256Hex } from "./rules-verify";

/**
 * Kural deposu kabul zinciri: boyut → şema → format → portal → minExtension → süre → sürüm → sha → imza. Her ret son iyi
 * sürümü korur. İmza gerçek WebCrypto ECDSA P-256 (P1363) ile test anahtarından üretilir.
 */

const NOW = Date.parse("2026-10-14T00:00:00Z");
const enc = new TextEncoder();

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { priv: kp.privateKey, jwk };
}

const b64url = (bytes: ArrayBuffer) => Buffer.from(new Uint8Array(bytes)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function ruleSet(version: number, patch: Partial<RuleSet> = {}): RuleSet {
  return { ...seedRuleSet("sahibinden"), version, issuedAt: "2026-10-13T00:00:00Z", expiresAt: "2026-10-27T00:00:00Z", minExtension: "0.6.0", ...patch };
}

async function envelope(rules: unknown, priv: CryptoKey, kid = "k1", portal = "sahibinden") {
  const sha = await sha256Hex(canonicalJson(rules));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, enc.encode(signedMessage(portal, (rules as RuleSet).version, sha)));
  return { portal, rules, sha256: sha, kid, sig: b64url(sig) };
}

describe("rules-store: decideAccept", () => {
  let priv: CryptoKey;
  let other: { priv: CryptoKey };
  let opts: { installedVersion: string; nowMs: number; keys: Record<string, JsonWebKey> };
  let v7: Awaited<ReturnType<typeof decideAccept>>;
  let lastGood: StoredRules;
  beforeAll(async () => {
    const k = await keypair();
    priv = k.priv;
    other = await keypair();
    opts = { installedVersion: "0.6.0", nowMs: NOW, keys: { k1: k.jwk } };
    v7 = await decideAccept(null, await envelope(ruleSet(7), priv), opts);
    lastGood = (v7 as { entry: StoredRules }).entry;
  });

  it("geçerli v7 kabul; üstüne v8 kabul (ileri yazım)", async () => {
    expect(v7.accept).toBe(true);
    expect(lastGood.version).toBe(7);
    const v8 = await decideAccept(lastGood, await envelope(ruleSet(8), priv), opts);
    expect(v8.accept).toBe(true);
    if (v8.accept) expect(v8.entry.version).toBe(8);
  });

  it.each([
    ["format 2", async () => envelope({ ...ruleSet(8), format: 2 }, priv), "format"],
    ["bilinmeyen anahtar", async () => envelope({ ...ruleSet(8), script: "x" }, priv), "invalid"],
    ["aynı sürüm", async () => envelope(ruleSet(7), priv), "not_newer"],
    ["düşük sürüm", async () => envelope(ruleSet(6), priv), "not_newer"],
    ["dev sürüm sıçraması (kilitleme)", async () => envelope(ruleSet(2_000_000), priv), "version_jump"],
    ["kurulu sürümden yeni minExtension", async () => envelope(ruleSet(8, { minExtension: "0.7.0" }), priv), "min_extension"],
    ["süresi dolmuş", async () => envelope(ruleSet(8, { issuedAt: "2026-09-01T00:00:00Z", expiresAt: "2026-09-10T00:00:00Z" }), priv), "expired"],
    ["portal uyuşmazlığı", async () => ({ ...(await envelope(ruleSet(8), priv)), portal: "emlakjet" }), "portal_mismatch"],
    ["sha uyuşmazlığı", async () => ({ ...(await envelope(ruleSet(8), priv)), sha256: "0".repeat(64) }), "sha_mismatch"],
    ["yanlış imza (başka anahtar)", async () => envelope(ruleSet(8), other.priv), "bad_signature"],
    ["bilinmeyen kid", async () => envelope(ruleSet(8), priv, "k9"), "unknown_kid"],
  ] as const)("%s → ret (%s), son iyi sürüm korunur", async (_n, make, reason) => {
    const d = await decideAccept(lastGood, await make(), opts);
    expect(d.accept).toBe(false);
    if (!d.accept) expect(d.reason).toBe(reason);
    expect(lastGood.version).toBe(7);
  });

  it("RULE_PUBLIC_KEYS boşken HER zarf reddedilir (tohumda kalınır)", async () => {
    const d = await decideAccept(null, await envelope(ruleSet(1), priv), { ...opts, keys: {} });
    expect(d).toMatchObject({ accept: false, reason: "no_keys" });
    // Varsayılan (paket içi) anahtar listesi bugün boş: imzalı da olsa kabul edilmez.
    const d2 = await decideAccept(null, await envelope(ruleSet(1), priv), { installedVersion: "0.6.0", nowMs: NOW });
    expect(d2.accept).toBe(false);
  });

  it("tohum sürümü (0) uzaktan kabul edilmez; 64 KB üstü zarf reddedilir", async () => {
    expect(await decideAccept(null, await envelope(ruleSet(0), priv), opts)).toMatchObject({ accept: false, reason: "invalid" });
    const big = await envelope(ruleSet(8), priv);
    expect(await decideAccept(null, { ...big, pad: "x".repeat(70_000) }, opts)).toMatchObject({ accept: false, reason: "too_large" });
  });

  it("applyRulesResponse: bozuk JSON → hata (depo aynı); zarf başına ret, diğer portal düşmez; aynı sürüm+sha ret sayılmaz", async () => {
    const stored = { sahibinden: lastGood };
    expect(await applyRulesResponse(stored, "{bozuk", opts)).toEqual({ error: "malformed" });
    expect(await applyRulesResponse(stored, JSON.stringify({ engine: "f1" }), opts)).toEqual({ error: "malformed" });
    const hepsi = await envelope({ ...ruleSet(3), portal: "hepsiemlak" }, priv, "k1", "hepsiemlak");
    const badSahibinden = { ...(await envelope(ruleSet(9), priv)), sig: "AAAA" };
    const r = await applyRulesResponse(stored, JSON.stringify({ engine: "f1", sets: [badSahibinden, hepsi] }), opts);
    if ("error" in r) throw new Error(r.error);
    expect(r.accepted).toEqual(["hepsiemlak"]);
    expect(r.rejected).toEqual([{ portal: "sahibinden", version: 9, reason: "bad_signature" }]);
    expect(r.stored.sahibinden).toBe(lastGood); // silinmedi, geriye yazılmadı
    expect(r.stored.hepsiemlak?.version).toBe(3);
    const same = await applyRulesResponse(r.stored, JSON.stringify({ engine: "f1", sets: [lastGood.envelope] }), opts);
    if ("error" in same) throw new Error(same.error);
    expect(same.rejected).toEqual([]);
    expect(await applyRulesResponse(stored, JSON.stringify({ engine: "f1", sets: [] }), opts)).toMatchObject({ accepted: [], rejected: [] });
  });

  it("tazeleme zamanı: 6 saat / 1 saat; hatada üstel bekleme 5 dk → 6 sa", () => {
    expect(rulesRefreshDue(EMPTY_RULES_META, NOW, 3_600_000)).toBe(true);
    const ok = { ...EMPTY_RULES_META, fetchedAt: NOW };
    expect(rulesRefreshDue(ok, NOW + 3_599_000, 3_600_000)).toBe(false);
    expect(rulesRefreshDue(ok, NOW + 3_600_000, 3_600_000)).toBe(true);
    expect(rulesRefreshDue({ ...ok, failures: 1 }, NOW + 4 * 60_000, 3_600_000)).toBe(false);
    expect(rulesRefreshDue({ ...ok, failures: 1 }, NOW + 5 * 60_000, 3_600_000)).toBe(true);
    expect(rulesRefreshDue({ ...ok, failures: 30 }, NOW + 6 * 3_600_000, 3_600_000)).toBe(true);
  });
});
