import "server-only";
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, type JsonWebKey as NodeJsonWebKey, type KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RULE_PUBLIC_KEYS } from "@/lib/portal-transfer/rule-keys";
import { RULE_LIMITS, ruleSetSha256, signedMessage, validateRuleSet, type RuleSet } from "@/lib/portal-transfer/rule-format";
import { restamp, stampFor, type ChangeSummary } from "@/lib/portal-transfer/rule-apply";
import type { TransferPortal } from "@/lib/portal-transfer/rules";

/**
 * KURAL SETİ İMZASI ve İMZALI YAYIN (yalnız sunucu). ECDSA P-256 / SHA-256, imza IEEE-P1363 (r||s, 64 bayt, base64url).
 * KRİTİK: WebCrypto (eklenti) P1363 bekler; Node varsayılanı DER'dir → `dsaEncoding: "ieee-p1363"` unutulursa her doğrulama
 * başarısız olur (test kilitler).
 *
 * K2 (eleştirmen): imza GET ucunda DEĞİL, YAYIN ANINDA üretilir — önce `validateRuleSet`, sonra sha, sonra imza; imza ve kid
 * satıra yazılır. GET ucu özel anahtarı hiç yüklemez, yalnız saklanan imzayı açık anahtarla doğrulayıp sunar. Böylece
 * veritabanına doğrudan yazılan (imzasız/bozuk) içerik eklentiye imzalı gitmez. Özel anahtar yalnız ortamda:
 * `PORTAL_RULES_SIGNING_KEY` (PKCS8 PEM) + `PORTAL_RULES_SIGNING_KID`; kid `RULE_PUBLIC_KEYS`'te yoksa ya da açık anahtar
 * eşleşmezse imzalama KAPALI sayılır (eklentinin doğrulayamayacağı imza üretilmez).
 */

type Db = SupabaseClient;

export type SigningKey = { kid: string; key: KeyObject };
export type SigningStatus = { ok: true; key: SigningKey } | { ok: false; reason: "missing" | "invalid_key" | "unknown_kid" | "key_mismatch" };

const KID_RE = /^[A-Za-z0-9._-]{1,40}$/;
const signCache = new Map<string, string>();
const verifyCache = new Map<string, boolean>();
const CACHE_MAX = 256;

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

/** Ortamdaki imza anahtarını yükler ve paketteki açık anahtarla eşleştiğini doğrular. */
export function loadSigningKey(
  env: Record<string, string | undefined> = process.env,
  publicKeys: Readonly<Record<string, JsonWebKey>> = RULE_PUBLIC_KEYS,
): SigningStatus {
  const pem = env.PORTAL_RULES_SIGNING_KEY?.trim();
  const kid = env.PORTAL_RULES_SIGNING_KID?.trim();
  if (!pem || !kid) return { ok: false, reason: "missing" };
  if (!KID_RE.test(kid)) return { ok: false, reason: "invalid_key" };
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem.replace(/\\n/g, "\n"), format: "pem" });
  } catch {
    return { ok: false, reason: "invalid_key" };
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return { ok: false, reason: "invalid_key" };
  const published = publicKeys[kid];
  if (!published) return { ok: false, reason: "unknown_kid" };
  const pub = createPublicKey(key).export({ format: "jwk" });
  if (pub.x !== published.x || pub.y !== published.y || published.crv !== "P-256") return { ok: false, reason: "key_mismatch" };
  return { ok: true, key: { kid, key } };
}

/** P1363 imza (base64url). Aynı ileti için bellekte önbellek. */
export function signRuleMessage(message: string, key: SigningKey): string {
  const ck = `${key.kid}|${message}`;
  const hit = signCache.get(ck);
  if (hit) return hit;
  const sig = nodeSign("sha256", Buffer.from(message, "utf8"), { key: key.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return remember(signCache, ck, sig);
}

/** Saklanan imzayı açık JWK ile doğrular (P1363). Önbellekli; bozuk girdi false. */
export function verifyRuleSignature(message: string, sig: string, jwk: JsonWebKey): boolean {
  const ck = `${jwk.x}|${jwk.y}|${message}|${sig}`;
  const hit = verifyCache.get(ck);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const pub = createPublicKey({ key: jwk as NodeJsonWebKey, format: "jwk" });
    const raw = Buffer.from(sig, "base64url");
    ok = raw.length === 64 && nodeVerify("sha256", Buffer.from(message, "utf8"), { key: pub, dsaEncoding: "ieee-p1363" }, raw);
  } catch {
    ok = false;
  }
  return remember(verifyCache, ck, ok);
}

export type SignedSet = { content: RuleSet; sha: string; sig: string; kid: string };

/** Doğrula → sha → imzala. Tohum (version 0) imzalanmaz. */
export async function signRuleSet(content: RuleSet, key: SigningKey): Promise<{ ok: true; signed: SignedSet } | { ok: false; reason: string }> {
  const v = validateRuleSet(content, { portal: content.portal });
  if (!v.ok) return { ok: false, reason: `invalid:${v.reason}` };
  const sha = await ruleSetSha256(v.set);
  const sig = signRuleMessage(signedMessage(v.set.portal, v.set.version, sha), key);
  return { ok: true, signed: { content: v.set, sha, sig, kid: key.kid } };
}

// ---------------------------------------------------------------------------------------------------------------------
// İmzalı yayın yardımcıları (yönetim eylemi ve öğrenme cron'u ortak kullanır)
// ---------------------------------------------------------------------------------------------------------------------

export type PublishedRow = { id: string; version: number; content: unknown; expires_at: string; kind: string };

export async function readPublished(db: Db, portal: TransferPortal): Promise<PublishedRow | null> {
  const { data, error } = await db
    .from("portal_rule_sets")
    .select("id, version, content, expires_at, kind")
    .eq("portal", portal)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw Object.assign(new Error(`portal_rule_sets: ${error.code ?? "?"}`), { pg: error });
  return (data as PublishedRow | null) ?? null;
}

export async function nextVersion(db: Db, portal: TransferPortal): Promise<number> {
  const { data, error } = await db.from("portal_rule_sets").select("version").eq("portal", portal).order("version", { ascending: false }).limit(1);
  if (error) throw Object.assign(new Error(`portal_rule_sets: ${error.code ?? "?"}`), { pg: error });
  const max = Array.isArray(data) && data[0] ? Number((data[0] as { version: number }).version) : 0;
  return max + 1;
}

export type PublishInput = {
  portal: TransferPortal;
  /** Yayınlanacak içerik (sürüm/zaman damgası burada yeniden basılır). */
  content: RuleSet;
  kind: "seed" | "staff" | "auto";
  parentId: string | null;
  changeSummary: ChangeSummary | (Record<string, unknown> & { count?: number });
  proposalIds?: string[];
  nowMs: number;
  key: SigningKey;
};

export type PublishResult = { ok: true; id: string; version: number } | { ok: false; reason: string };

/**
 * Damgala (max+1, şimdi, 14 gün) → doğrula → imzala → RPC. `auto` → `pt_rules_publish_system` (service_role), diğerleri →
 * `pt_rules_admin_publish` (super_admin oturumu). Eşzamanlı yayında sürüm çakışırsa bir kez yeniden dener.
 */
export async function publishRuleSet(db: Db, input: PublishInput): Promise<PublishResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const version = await nextVersion(db, input.portal);
    const stamped = restamp(input.content, stampFor(version, input.nowMs, RULE_LIMITS.ttlDays));
    const signed = await signRuleSet(stamped, input.key);
    if (!signed.ok) return { ok: false, reason: signed.reason };
    const s = signed.signed;
    const fn = input.kind === "auto" ? "pt_rules_publish_system" : "pt_rules_admin_publish";
    const { data, error } = await db.rpc(fn, {
      p_portal: input.portal,
      p_content: s.content,
      p_kind: input.kind,
      p_parent: input.parentId,
      p_change_summary: input.changeSummary,
      p_sha: s.sha,
      p_signature: s.sig,
      p_kid: s.kid,
      p_proposal_ids: input.proposalIds?.length ? input.proposalIds : null,
    });
    if (error) return { ok: false, reason: `rpc:${error.code ?? "?"}` };
    const r = (data ?? {}) as { outcome?: string; id?: string; version?: number };
    if (r.outcome === "version_conflict" && attempt === 0) continue;
    if (r.outcome !== "ok" || !r.id) return { ok: false, reason: String(r.outcome ?? "rpc_error") };
    return { ok: true, id: r.id, version: Number(r.version) };
  }
  return { ok: false, reason: "version_conflict" };
}

/**
 * Geri alma: hedef sürümün İÇERİĞİ yeni (max+1) sürüm olarak, bugünkü doğrulayıcıdan geçerek (N3) imzalanır.
 * Yalnız super_admin oturumuyla (`pt_rules_admin_rollback`).
 */
export async function rollbackRuleSet(db: Db, input: { portal: TransferPortal; toVersion: number; nowMs: number; key: SigningKey }): Promise<PublishResult> {
  const { data, error } = await db
    .from("portal_rule_sets")
    .select("content")
    .eq("portal", input.portal)
    .eq("version", input.toVersion)
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) return { ok: false, reason: `read:${error.code ?? "?"}` };
  if (!data) return { ok: false, reason: "not_found" };
  const old = validateRuleSet((data as { content: unknown }).content, { portal: input.portal });
  if (!old.ok) return { ok: false, reason: `invalid_target:${old.reason}` };
  const version = await nextVersion(db, input.portal);
  const signed = await signRuleSet(restamp(old.set, stampFor(version, input.nowMs, RULE_LIMITS.ttlDays)), input.key);
  if (!signed.ok) return { ok: false, reason: signed.reason };
  const s = signed.signed;
  const res = await db.rpc("pt_rules_admin_rollback", {
    p_portal: input.portal,
    p_to_version: input.toVersion,
    p_content: s.content,
    p_sha: s.sha,
    p_signature: s.sig,
    p_kid: s.kid,
  });
  if (res.error) return { ok: false, reason: `rpc:${res.error.code ?? "?"}` };
  const r = (res.data ?? {}) as { outcome?: string; id?: string; version?: number };
  if (r.outcome !== "ok" || !r.id) return { ok: false, reason: String(r.outcome ?? "rpc_error") };
  return { ok: true, id: r.id, version: Number(r.version) };
}
