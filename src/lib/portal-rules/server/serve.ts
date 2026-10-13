import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { RULE_PUBLIC_KEYS } from "@/lib/portal-transfer/rule-keys";
import {
  FORM_RULES_ENGINE,
  RULE_LIMITS,
  canonicalJson,
  compareVersions,
  isRuleSetExpired,
  ruleSetSha256,
  signedMessage,
  utf8Length,
  validateRuleSet,
  type RuleEnvelope,
} from "@/lib/portal-transfer/rule-format";
import { isTransferPortal } from "@/lib/portal-transfer/rules";
import { verifyRuleSignature } from "./sign";

/**
 * KURAL SUNUMU (GET /api/app/portal-aktar/kurallar). Veritabanından gelen her yayın satırı eklentiye gitmeden önce burada
 * yeniden doğrulanır: `validateRuleSet` (aynı doğrulayıcı) → sha'yı TS'te `canonicalJson` ile yeniden hesapla (O2: SQL
 * sha'sına güvenilmez) → süre (K3) → SAKLANAN imzayı paketteki açık anahtarla doğrula (K2). Geçemeyen set atlanır (log),
 * diğer portallar etkilenmez (O1). Özel anahtar bu yolda hiç yüklenmez.
 */

type Db = SupabaseClient;

export const MIN_EXTENSION_VERSION = "0.6.0";

/** x-emlaksoft-ext başlığı ≥0.6.0 mı? (Kimlik değildir; yalnız uyumluluk.) */
export function isSupportedExtension(header: string | null): boolean {
  const v = (header ?? "").trim();
  const c = compareVersions(v, MIN_EXTENSION_VERSION);
  return Number.isFinite(c) && c >= 0;
}

type Row = { portal: string; version: number; content: unknown; content_sha256: string; signature: string; kid: string; expires_at: string };

export type ServeResult =
  | { status: "ok"; sets: RuleEnvelope[]; etag: string; skipped: { portal: string; reason: string }[] }
  | { status: "signing_unavailable" }
  | { status: "schema_pending" }
  | { status: "forbidden" }
  | { status: "error" };

export function etagFor(sets: readonly RuleEnvelope[]): string {
  const basis = sets.map((s) => `${s.portal}:${s.rules.version}:${s.sha256}:${s.kid}:${s.sig}`).join("|");
  return `"${createHash("sha256").update(`${FORM_RULES_ENGINE}|${basis}`).digest("hex")}"`;
}

/** If-None-Match (liste, W/ öneki ve * dahil) bu ETag'i kapsıyor mu? */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === etag);
}

export async function loadServableRuleSets(
  db: Db,
  opts: { nowMs: number; publicKeys?: Readonly<Record<string, JsonWebKey>> },
): Promise<ServeResult> {
  const keys = opts.publicKeys ?? RULE_PUBLIC_KEYS;
  if (Object.keys(keys).length === 0) return { status: "signing_unavailable" };
  const { data, error } = await db.rpc("pt_rules_current", { p_engine: FORM_RULES_ENGINE });
  if (error) {
    if (isMissingSchema(error)) return { status: "schema_pending" };
    console.error("pt_rules_current", { code: error.code });
    return { status: "error" };
  }
  const r = (data ?? {}) as { outcome?: string; sets?: Row[] };
  if (r.outcome === "forbidden") return { status: "forbidden" };
  if (r.outcome !== "ok" || !Array.isArray(r.sets)) return { status: "error" };

  const sets: RuleEnvelope[] = [];
  const skipped: { portal: string; reason: string }[] = [];
  let total = 0;
  for (const row of r.sets) {
    const portal = String(row.portal);
    const skip = (reason: string) => {
      skipped.push({ portal, reason });
      console.error("portal kural seti sunulmadı", { portal, version: row.version, reason });
    };
    if (!isTransferPortal(portal)) {
      skip("portal");
      continue;
    }
    const v = validateRuleSet(row.content, { portal });
    if (!v.ok) {
      skip(`invalid:${v.reason}`);
      continue;
    }
    if (v.set.version !== Number(row.version)) {
      skip("version_mismatch");
      continue;
    }
    if (isRuleSetExpired(v.set, opts.nowMs)) {
      skip("expired");
      continue;
    }
    const sha = await ruleSetSha256(v.set);
    if (sha !== row.content_sha256) {
      skip("sha_mismatch");
      continue;
    }
    const jwk = keys[row.kid];
    if (!jwk) {
      skip("unknown_kid");
      continue;
    }
    if (!verifyRuleSignature(signedMessage(portal, v.set.version, sha), row.signature, jwk)) {
      skip("bad_signature");
      continue;
    }
    total += utf8Length(canonicalJson(v.set));
    if (total > RULE_LIMITS.maxResponseBytes) {
      skip("response_too_large");
      continue;
    }
    sets.push({ portal, rules: v.set, sha256: sha, kid: row.kid, sig: row.signature });
  }
  return { status: "ok", sets, etag: etagFor(sets), skipped };
}
