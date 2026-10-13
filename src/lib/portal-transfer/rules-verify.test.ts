import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, signedMessage } from "./rule-format";
import { seedRuleSet } from "./seed-rules";
import { base64UrlToBytes, sha256Hex, verifyEnvelope } from "./rules-verify";

/** İmza döngüsü: sunucu node:crypto ile IEEE-P1363 imzalar, eklenti WebCrypto ile doğrular. DER imza REDDEDİLİR. */

const rules = { ...seedRuleSet("emlakjet"), version: 4, issuedAt: "2026-10-13T00:00:00Z", expiresAt: "2026-10-27T00:00:00Z", minExtension: "0.6.0" };

function nodeKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey, jwk: publicKey.export({ format: "jwk" }) as JsonWebKey };
}

async function signed(dsaEncoding: "ieee-p1363" | "der") {
  const { privateKey, jwk } = nodeKeys();
  const sha = await sha256Hex(canonicalJson(rules));
  const s = createSign("sha256");
  s.update(signedMessage("emlakjet", 4, sha));
  const sig = s.sign({ key: privateKey, dsaEncoding }).toString("base64url");
  return { env: { portal: "emlakjet", rules, sha256: sha, kid: "k1", sig }, keys: { k1: jwk } };
}

describe("rules-verify", () => {
  it("node:crypto P1363 imza → WebCrypto doğrular", async () => {
    const { env, keys } = await signed("ieee-p1363");
    expect(await verifyEnvelope(env, keys)).toEqual({ ok: true });
  });
  it("DER imza, değişmiş içerik, bilinmeyen kid ve boş anahtar listesi reddedilir", async () => {
    const der = await signed("der");
    expect((await verifyEnvelope(der.env, der.keys)).ok).toBe(false);
    const { env, keys } = await signed("ieee-p1363");
    expect(await verifyEnvelope({ ...env, rules: { ...rules, version: 5 } }, keys)).toEqual({ ok: false, reason: "sha_mismatch" });
    expect(await verifyEnvelope({ ...env, kid: "k2" }, keys)).toEqual({ ok: false, reason: "unknown_kid" });
    expect(await verifyEnvelope(env, {})).toEqual({ ok: false, reason: "no_keys" });
    expect(await verifyEnvelope({ ...env, sig: "!!" }, keys)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyEnvelope({ ...env, sha256: "x" }, keys)).toEqual({ ok: false, reason: "malformed" });
  });
  it("base64url çözümü", () => {
    expect(Array.from(base64UrlToBytes("AQID_-8")!)).toEqual([1, 2, 3, 255, 239]);
    expect(base64UrlToBytes("a+b")).toBeNull();
  });
});
