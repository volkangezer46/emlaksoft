import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings/read";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { RISKY_FIELD_KEYS, RULE_LIMITS } from "@/lib/portal-transfer/rule-format";
import { isPersonalLabel, looksPersonal } from "@/lib/portal-transfer/feedback-format";
import { FIELD_RULES, FILL_FIELD_KEYS, fold, type FillFieldKey, type TransferPortal } from "@/lib/portal-transfer/rules";

/**
 * AI ÖNERİSİ (yönetim ekranındaki "AI önerisi üret" düğmesi; cron'da ÇALIŞMAZ). Girdi yalnız katalogda EŞLEŞMEMİŞ ve
 * ≥ `portal_rules.ai_min_tenants` (varsayılan 2) farklı ofiste görülmüş alanların katlanmış etiketi, türü ve seçenekleri
 * (en çok 40) + FILL_FIELD_KEYS. Kullanıcı değeri YOK. Çağrı yalnız `openAiChat` (Redactor içeride); kiracısız olduğu için
 * `audit: null` ve denetim `logPlatformActivity` ile yazılır. Çıktı JSON olarak doğrulanır: `field_sig` girdide olmalı,
 * `field_key` FILL_FIELD_KEYS içinde ve RİSKLİ olmamalı; etiket MODELDEN DEĞİL girdiden alınır (model metin uyduramaz, O6).
 * Öneri `source='ai'`, `ai_unverified=true`, `state='ready'` olarak yazılır ve KENDİ BAŞINA onaylanmaz.
 * Sınırlar: portal başına 10 dakikada 1, platform genelinde günde 20 çağrı (deny).
 */

type Db = SupabaseClient;

const MAX_FIELDS = 40;
const TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const SUGGESTABLE_KEYS = FILL_FIELD_KEYS.filter((k) => !RISKY_FIELD_KEYS.includes(k));

type CatalogRow = { field_sig: string; control: string; label_folded: string | null; options_folded: string[] | null; distinct_tenants: number };

export type SuggestResult =
  | { ok: true; outcome: "no_input"; created: 0 }
  | { ok: true; outcome: "ok"; created: number; skipped: number; model: string }
  | { ok: false; error: "rate_limited" | "ai_unconfigured" | "schema_pending" | "ai_failed" | "invalid_output" | "rpc_error" | "forbidden" };

/** Model çıktısını doğrular; yalnız girdideki imzalar ve izinli anahtarlar kalır. SAF (testli). */
export function parseSuggestions(
  content: string | null,
  input: readonly CatalogRow[],
): { field_sig: string; field_key: FillFieldKey; label: string; confidence: number; support_tenants: number }[] | null {
  if (!content) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return null;
  const bySig = new Map(input.map((r) => [r.field_sig, r]));
  const out: { field_sig: string; field_key: FillFieldKey; label: string; confidence: number; support_tenants: number }[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_FIELDS)) {
    if (!item || typeof item !== "object") continue;
    const { field_sig, field_key, confidence } = item as Record<string, unknown>;
    if (typeof field_sig !== "string" || typeof field_key !== "string") continue;
    const row = bySig.get(field_sig);
    if (!row || !row.label_folded || seen.has(field_sig)) continue;
    if (!(SUGGESTABLE_KEYS as readonly string[]).includes(field_key)) continue;
    const label = fold(row.label_folded);
    if (label.length < RULE_LIMITS.minLabel || label.length > RULE_LIMITS.maxText || !/[a-z]/.test(label)) continue;
    if (looksPersonal(label) || isPersonalLabel(label)) continue;
    // Denetim türü tohumla uyumlu olmalı (ör. seçimli alan metin anahtarına eşlenmez).
    const seedControl = FIELD_RULES.find((r) => r.key === field_key)?.control;
    if (seedControl && seedControl !== row.control) continue;
    seen.add(field_sig);
    out.push({
      field_sig,
      field_key: field_key as FillFieldKey,
      label,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      support_tenants: row.distinct_tenants,
    });
  }
  return out;
}

export async function suggestPortalRules(input: { db: Db; portal: TransferPortal; actorId: string }): Promise<SuggestResult> {
  const { db, portal, actorId } = input;
  const perPortal = await checkRateLimit(`pt-ai-oneri:${portal}`, { limit: 1, windowSec: 600, failurePolicy: "deny" });
  if (!perPortal.allowed) return { ok: false, error: "rate_limited" };
  const daily = await checkRateLimit("pt-ai-oneri:gunluk", { limit: 20, windowSec: 86_400, failurePolicy: "deny" });
  if (!daily.allowed) return { ok: false, error: "rate_limited" };

  const minTenants = Math.max(1, Math.min(5, Number(await getSetting<number>("portal_rules.ai_min_tenants")) || 2));
  const { data, error } = await db
    .from("portal_form_fields")
    .select("field_sig, control, label_folded, options_folded, distinct_tenants")
    .eq("portal", portal)
    .is("mapped_key", null)
    .not("label_folded", "is", null)
    .gte("distinct_tenants", Math.max(2, minTenants))
    .order("distinct_tenants", { ascending: false })
    .limit(MAX_FIELDS);
  if (error) return { ok: false, error: isMissingSchema(error) ? "schema_pending" : "rpc_error" };
  const rows = ((data ?? []) as CatalogRow[]).filter((r) => r.label_folded && !looksPersonal(r.label_folded) && !isPersonalLabel(r.label_folded));
  if (rows.length === 0) return { ok: true, outcome: "no_input", created: 0 };

  const apiKey = await getOpenAiKey();
  if (!apiKey) return { ok: false, error: "ai_unconfigured" };
  const model = getOpenAiChatModel();
  const fields = rows.map((r) => ({
    field_sig: r.field_sig,
    control: r.control,
    label: r.label_folded,
    options: (r.options_folded ?? []).filter((o) => !looksPersonal(o)).slice(0, 20),
  }));
  const keys = SUGGESTABLE_KEYS.map((k) => ({ key: k, label: FIELD_RULES.find((r) => r.key === k)?.label ?? k }));

  let content: string | null;
  let redactedCounts: Record<string, number> = {};
  try {
    const res = await openAiChat({
      apiKey,
      purpose: "portal_rule_suggest",
      body: {
        model,
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Türk emlak portalı ilan formundaki eşleşmemiş alanları EmlakSoft alan anahtarlarına eşle. Yalnız verilen field_sig ve key değerlerini kullan; emin değilsen alanı atla. Yalnız JSON döndür: {\"suggestions\":[{\"field_sig\":\"...\",\"field_key\":\"...\",\"confidence\":0.0}]}",
          },
          { role: "user", content: JSON.stringify({ portal, keys, fields }) },
        ],
      },
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      audit: null,
    });
    content = res.content;
    redactedCounts = { ...res.redactor.counts } as Record<string, number>;
  } catch (e) {
    console.error("portal kural AI önerisi", e instanceof Error ? e.name : "hata");
    await logPlatformActivity({ actorId, action: "ai.portal_rule_suggest", entityType: "portal_rule_ai", meta: { portal, model, fields_n: rows.length, outcome: "error" } });
    return { ok: false, error: "ai_failed" };
  }

  const suggestions = parseSuggestions(content, rows);
  await logPlatformActivity({
    actorId,
    action: "ai.portal_rule_suggest",
    entityType: "portal_rule_ai",
    meta: { portal, model, fields_n: rows.length, suggestions_n: suggestions?.length ?? 0, redacted: redactedCounts, outcome: suggestions ? "ok" : "invalid_output" },
  });
  if (!suggestions) return { ok: false, error: "invalid_output" };
  if (suggestions.length === 0) return { ok: true, outcome: "ok", created: 0, skipped: 0, model };

  const rec = await db.rpc("pt_rules_admin_record_ai", { p_portal: portal, p_model: model, p_items: suggestions });
  if (rec.error) return { ok: false, error: isMissingSchema(rec.error) ? "schema_pending" : "rpc_error" };
  const r = (rec.data ?? {}) as { outcome?: string; created?: number; skipped?: number };
  if (r.outcome === "forbidden") return { ok: false, error: "forbidden" };
  if (r.outcome !== "ok") return { ok: false, error: "rpc_error" };
  return { ok: true, outcome: "ok", created: Number(r.created ?? 0), skipped: Number(r.skipped ?? 0), model };
}
