import { canonicalJson, signedMessage, type RuleEnvelope } from "./rule-format";
import { RULE_PUBLIC_KEYS } from "./rule-keys";

/**
 * KURAL ZARFI İMZA DOĞRULAMASI (SAF, async; WebCrypto). Eklenti, sunucudan gelen kural setini yalnız pakete gömülü açık
 * anahtarla (`rule-keys.ts`) imzası doğrulanırsa kullanır: ECDSA P-256 / SHA-256, imza IEEE-P1363 (r||s) base64url,
 * imzalanan dize `es-rules|f1|<portal>|<version>|<sha256>`, sha256 = canonicalJson(rules) özeti.
 * Anahtar listesi boşsa HER zarf reddedilir (eklenti tohumda kalır). Hiçbir durumda fırlatmaz; neden döner.
 */

/** Zarfın biçimi doğrulanmadan önceki hali (sunucudan gelen ham nesne). */
export type UnverifiedEnvelope = { portal: string; rules: unknown; sha256: string; kid: string; sig: string };

export type VerifyResult = { ok: true } | { ok: false; reason: "no_keys" | "unknown_kid" | "sha_mismatch" | "bad_signature" | "malformed" };

const enc = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64UrlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  try {
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Zarfın biçimi (alan türleri) — içerik doğrulaması `validateRuleSet` ile ayrıca yapılır. */
export function isEnvelopeShape(v: unknown): v is UnverifiedEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.portal === "string" &&
    typeof e.rules === "object" &&
    e.rules !== null &&
    typeof e.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(e.sha256) &&
    typeof e.kid === "string" &&
    e.kid.length > 0 &&
    e.kid.length <= 40 &&
    typeof e.sig === "string" &&
    e.sig.length > 0 &&
    e.sig.length <= 200
  );
}

export async function verifyEnvelope(env: RuleEnvelope | UnverifiedEnvelope, keys: Readonly<Record<string, JsonWebKey>> = RULE_PUBLIC_KEYS): Promise<VerifyResult> {
  if (!isEnvelopeShape(env)) return { ok: false, reason: "malformed" };
  if (Object.keys(keys).length === 0) return { ok: false, reason: "no_keys" };
  const jwk = Object.prototype.hasOwnProperty.call(keys, env.kid) ? keys[env.kid] : undefined;
  if (!jwk) return { ok: false, reason: "unknown_kid" };
  const rules = env.rules as { version?: unknown };
  let sha: string;
  try {
    sha = await sha256Hex(canonicalJson(env.rules));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (sha !== env.sha256) return { ok: false, reason: "sha_mismatch" };
  const sig = base64UrlToBytes(env.sig);
  if (!sig || sig.length !== 64) return { ok: false, reason: "bad_signature" };
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig as BufferSource,
      enc.encode(signedMessage(env.portal, Number(rules.version), sha)) as BufferSource,
    );
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}
