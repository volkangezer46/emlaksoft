import { FORM_RULES_FORMAT, RULE_LIMITS, compareVersions, isRuleSetExpired, ruleSetSha256, validateRuleSet, type RuleEnvelope, type RuleSet } from "./rule-format";
import { RULE_PUBLIC_KEYS } from "./rule-keys";
import { isEnvelopeShape, verifyEnvelope } from "./rules-verify";

/**
 * KURAL DEPOSU KARARLARI (SAF, testli). Eklenti sunucudan gelen her portal zarfını şu sırayla denetler; herhangi biri
 * başarısızsa ESKİ (son iyi) set korunur, eski set yoksa tohum kullanılır:
 *   boyut (zarf başına ≤64 KB) → format === 1 → validateRuleSet (bilinmeyen anahtar → ret; portal zarfınkine eşit) →
 *   minExtension ≤ kurulu sürüm → süresi dolmamış → lastGood < sürüm ≤ lastGood + 1000 → sha256(canonicalJson) → ECDSA imzası.
 * Depo yalnız İLERİ yazılır: kabul edilen set önceki setin yerini alır, hiçbir durumda silinmez.
 */

export const RULES_ENVELOPE_MAX_BYTES = RULE_LIMITS.maxBytes + 2_048; // set + zarf alanları (sha, kid, imza)
/** Üç portal zarfının toplamı (yanıt gövdesi). */
export const RULES_RESPONSE_MAX_BYTES = RULE_LIMITS.maxResponseBytes;
/** Tek sıçramada kabul edilen en büyük sürüm artışı (yanlış/kötü niyetli dev sürüm eklentiyi kilitlemesin). */
export const RULES_MAX_VERSION_JUMP = 1000;

/** chrome.storage.local `es_form_rules[portal]`: kabul edilmiş zarf (popup imzayı kullanmadan önce yeniden doğrular). */
export type StoredRules = { envelope: RuleEnvelope; version: number; sha256: string; kid: string; acceptedAt: number };
export type StoredRulesMap = Partial<Record<string, StoredRules>>;

export type RulesMeta = {
  etag: string | null;
  fetchedAt: number | null;
  lastError: string | null;
  /** Ardışık başarısız tazeleme (üstel bekleme için). */
  failures: number;
  rejects: number;
  lastRejectReason: string | null;
  lastRejectVersion: number | null;
};

export const EMPTY_RULES_META: RulesMeta = { etag: null, fetchedAt: null, lastError: null, failures: 0, rejects: 0, lastRejectReason: null, lastRejectVersion: null };

export type RejectReason =
  | "too_large"
  | "malformed"
  | "format"
  | "invalid"
  | "portal_mismatch"
  | "min_extension"
  | "expired"
  | "not_newer"
  | "version_jump"
  | "sha_mismatch"
  | "no_keys"
  | "unknown_kid"
  | "bad_signature";

export type AcceptDecision = { accept: true; entry: StoredRules; set: RuleSet } | { accept: false; reason: RejectReason; version: number | null; portal: string | null };

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export async function decideAccept(
  lastGood: StoredRules | null,
  envelope: unknown,
  opts: { installedVersion: string; nowMs: number; keys?: Readonly<Record<string, JsonWebKey>> },
): Promise<AcceptDecision> {
  const raw = (typeof envelope === "object" && envelope !== null ? envelope : {}) as Record<string, unknown>;
  const rules0 = (typeof raw.rules === "object" && raw.rules !== null ? raw.rules : {}) as Record<string, unknown>;
  const version0 = typeof rules0.version === "number" && Number.isInteger(rules0.version) ? rules0.version : null;
  const portal0 = typeof raw.portal === "string" ? raw.portal.slice(0, 20) : null;
  const reject = (reason: RejectReason): AcceptDecision => ({ accept: false, reason, version: version0, portal: portal0 });

  let size: number;
  try {
    size = byteLength(JSON.stringify(envelope) ?? "");
  } catch {
    return reject("malformed");
  }
  if (size > RULES_ENVELOPE_MAX_BYTES) return reject("too_large");
  if (!isEnvelopeShape(envelope)) return reject("malformed");
  if (rules0.format !== FORM_RULES_FORMAT) return reject("format");
  const v = validateRuleSet(envelope.rules, { allowSeed: false });
  if (!v.ok) return reject("invalid");
  const set = v.set;
  if (set.portal !== envelope.portal) return reject("portal_mismatch");
  if (!(compareVersions(set.minExtension, opts.installedVersion) <= 0)) return reject("min_extension");
  if (isRuleSetExpired(set, opts.nowMs)) return reject("expired");
  const floor = lastGood?.version ?? 0;
  if (set.version <= floor) return reject("not_newer");
  if (set.version > floor + RULES_MAX_VERSION_JUMP) return reject("version_jump");
  const sha = await ruleSetSha256(envelope.rules);
  if (sha !== envelope.sha256) return reject("sha_mismatch");
  const verified = await verifyEnvelope(envelope, opts.keys ?? RULE_PUBLIC_KEYS);
  if (!verified.ok) return reject(verified.reason === "malformed" ? "malformed" : verified.reason);
  return {
    accept: true,
    set,
    entry: { envelope: { portal: set.portal, rules: envelope.rules as RuleSet, sha256: sha, kid: envelope.kid, sig: envelope.sig }, version: set.version, sha256: sha, kid: envelope.kid, acceptedAt: opts.nowMs },
  };
}

export type ApplyResult = { stored: StoredRulesMap; accepted: string[]; rejected: { portal: string | null; version: number | null; reason: RejectReason }[] };

/**
 * Uç yanıtını (`{engine:"f1", sets:[zarf...]}` ham metni) depoya uygular. Ret zarf başınadır: bir portalın bozuk zarfı
 * diğerlerini düşürmez. Aynı sürüm + aynı sha (değişiklik yok) ret sayılmaz. Depo yalnız ileri yazılır.
 */
export async function applyRulesResponse(
  stored: StoredRulesMap,
  rawText: string,
  opts: { installedVersion: string; nowMs: number; keys?: Readonly<Record<string, JsonWebKey>> },
): Promise<ApplyResult | { error: "too_large" | "malformed" }> {
  if (typeof rawText !== "string" || byteLength(rawText) > RULES_RESPONSE_MAX_BYTES) return { error: "too_large" };
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return { error: "malformed" };
  }
  const sets = (body as { sets?: unknown } | null)?.sets;
  if (typeof body !== "object" || body === null || !Array.isArray(sets)) return { error: "malformed" };
  const next: StoredRulesMap = { ...stored };
  const accepted: string[] = [];
  const rejected: ApplyResult["rejected"] = [];
  for (const env of sets.slice(0, 6)) {
    const portal = typeof (env as { portal?: unknown })?.portal === "string" ? (env as { portal: string }).portal : null;
    const last = portal && Object.prototype.hasOwnProperty.call(next, portal) ? (next[portal] ?? null) : null;
    const d = await decideAccept(last, env, opts);
    if (d.accept) {
      next[d.set.portal] = d.entry;
      accepted.push(d.set.portal);
    } else if (!(d.reason === "not_newer" && last && d.version === last.version && (env as { sha256?: unknown }).sha256 === last.sha256)) {
      rejected.push({ portal: d.portal, version: d.version, reason: d.reason });
    }
  }
  return { stored: next, accepted, rejected };
}

/** Tazeleme zamanı geldi mi: başarıdan sonra `maxAgeMs`, hatadan sonra üstel bekleme (5 dk → 6 sa). */
export function rulesRefreshDue(meta: RulesMeta, nowMs: number, maxAgeMs: number): boolean {
  if (meta.fetchedAt === null) return true;
  const wait = meta.failures > 0 ? Math.min(6 * 3_600_000, 5 * 60_000 * 2 ** Math.min(10, meta.failures - 1)) : maxAgeMs;
  return nowMs - meta.fetchedAt >= wait;
}
