import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayStartIso } from "@/lib/clock";
import { SUPPRESSION_DAYS, suppressionKey } from "@/lib/insights/dedupe";
import type { RuleQualityRow } from "@/lib/insights/quality";
import { INSIGHT_EXCLUDED_ROLES, ruleBase, type InsightDraft, type InsightSeverity } from "@/lib/insights/types";
import { isMissingSchemaError } from "@/lib/insights/facts";

/**
 * Engine tarafı depo işlemleri (service_role istemcisi PARAMETRE olarak gelir; bu dosya istemci oluşturmaz).
 * Her sorgu AÇIK `tenant_id` filtresi taşır (service_role RLS'i atlar).
 */

export type Recipient = { id: string; role: string };

export type InsightRow = {
  tenant_id: string;
  recipient_user_id: string;
  kind: string;
  rule_id: string;
  severity: InsightSeverity;
  priority: number;
  title: string;
  why: string;
  evidence: unknown;
  href: string;
  entity_type: string | null;
  entity_id: string | null;
  is_forecast: boolean;
  confidence: string | null;
  dedupe_key: string;
  valid_until: string;
  narrative?: string | null;
  narrative_source?: "rule" | "ai";
};

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Taslak + alıcı + öncelik → DB satırı (alan uzunlukları şema CHECK'lerine göre kırpılır). */
export function toInsightRow(args: {
  tenantId: string;
  userId: string;
  draft: InsightDraft;
  priority: number;
  priorityNote: string;
  narrative?: string | null;
}): InsightRow {
  const { draft } = args;
  return {
    tenant_id: args.tenantId,
    recipient_user_id: args.userId,
    kind: draft.kind,
    rule_id: draft.ruleId,
    severity: draft.severity,
    priority: args.priority,
    title: clip(draft.title, 200),
    why: clip(draft.why, 600),
    evidence: [...draft.evidence, { label: "Sıra", value: args.priorityNote }].slice(0, 8),
    href: draft.href.startsWith("/") ? clip(draft.href, 500) : "/app",
    entity_type: draft.entityType,
    entity_id: draft.entityId,
    is_forecast: draft.isForecast,
    confidence: draft.confidence,
    dedupe_key: draft.dedupeKey,
    valid_until: new Date(draft.validUntilMs).toISOString(),
    ...(args.narrative ? { narrative: clip(args.narrative, 600), narrative_source: "ai" as const } : {}),
  };
}

/** Aktif, içgörü alabilen kullanıcılar (readonly hariç). */
export async function loadActiveRecipients(admin: SupabaseClient, tenantId: string): Promise<Recipient[]> {
  const { data, error } = await admin.from("profiles").select("id, role").eq("tenant_id", tenantId).eq("is_active", true).limit(2000);
  if (error) throw new Error(`profiles: ${error.code ?? "hata"}`);
  const excluded = new Set<string>(INSIGHT_EXCLUDED_ROLES);
  return ((data ?? []) as { id: string; role: string }[]).filter((p) => !excluded.has(p.role)).map((p) => ({ id: p.id, role: p.role }));
}

export type SuppressionState = {
  /** `${userId}|${ruleBase}|${entityId}` — yakın zamanda "ilgisiz/yanlış" yoksayılanlar (30 gün). */
  suppressed: Set<string>;
  /** Kural taban adı → son 14 gündeki yoksayma sayısı (öncelik cezası). */
  dismissalsByRule: Map<string, number>;
};

export async function loadSuppressions(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<SuppressionState> {
  const out: SuppressionState = { suppressed: new Set(), dismissalsByRule: new Map() };
  const since = new Date(nowMs - SUPPRESSION_DAYS * DAY_MS).toISOString();
  const { data, error } = await admin
    .from("insights")
    .select("recipient_user_id, rule_id, entity_id, state_reason, updated_at")
    .eq("tenant_id", tenantId)
    .eq("state", "dismissed")
    .gte("updated_at", since)
    .limit(5000);
  if (error) {
    if (isMissingSchemaError(error)) return out;
    throw new Error(`insights(suppressions): ${error.code ?? "hata"}`);
  }
  const recentSince = nowMs - 14 * DAY_MS;
  for (const r of (data ?? []) as { recipient_user_id: string; rule_id: string; entity_id: string | null; state_reason: string | null; updated_at: string }[]) {
    const base = ruleBase(r.rule_id);
    if (r.state_reason === "ilgisiz" || r.state_reason === "yanlis") {
      out.suppressed.add(suppressionKey(r.recipient_user_id, base, r.entity_id));
    }
    if (new Date(r.updated_at).getTime() >= recentSince) out.dismissalsByRule.set(base, (out.dismissalsByRule.get(base) ?? 0) + 1);
  }
  return out;
}

/** `insight_rule_quality` görünümü (yoksa boş). */
export async function loadRuleQuality(admin: SupabaseClient, tenantId: string): Promise<RuleQualityRow[]> {
  const { data, error } = await admin
    .from("insight_rule_quality")
    .select("rule_id, accepted, dismissed, dismissed_wrong")
    .eq("tenant_id", tenantId);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error(`insight_rule_quality: ${error.code ?? "hata"}`);
  }
  return ((data ?? []) as { rule_id: string; accepted: number; dismissed: number; dismissed_wrong: number }[]).map((r) => ({
    ruleId: r.rule_id,
    accepted: Number(r.accepted) || 0,
    dismissed: Number(r.dismissed) || 0,
    dismissedWrong: Number(r.dismissed_wrong) || 0,
  }));
}

/** Kullanıcı başına AÇIK (new/seen/snoozed ve süresi dolmamış) içgörülerin dedupe anahtarları (üst sınır + tekrar eleme). */
export async function loadOpenKeys(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const { data, error } = await admin
    .from("insights")
    .select("recipient_user_id, dedupe_key")
    .eq("tenant_id", tenantId)
    .in("state", ["new", "seen", "snoozed"])
    .gt("valid_until", new Date(nowMs).toISOString())
    .limit(10000);
  if (error) {
    if (isMissingSchemaError(error)) return out;
    throw new Error(`insights(open): ${error.code ?? "hata"}`);
  }
  for (const r of (data ?? []) as { recipient_user_id: string; dedupe_key: string }[]) {
    const set = out.get(r.recipient_user_id) ?? new Set<string>();
    set.add(r.dedupe_key);
    out.set(r.recipient_user_id, set);
  }
  return out;
}

/** Bugün (TR günü) zile düşürülmüş içgörü sayısı, kullanıcı başına (günlük üst sınır için). */
export async function loadNotifiedToday(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data, error } = await admin
    .from("insights")
    .select("recipient_user_id")
    .eq("tenant_id", tenantId)
    .gte("notified_at", trDayStartIso(nowMs))
    .limit(10000);
  if (error) {
    if (isMissingSchemaError(error)) return out;
    throw new Error(`insights(notified): ${error.code ?? "hata"}`);
  }
  for (const r of (data ?? []) as { recipient_user_id: string }[]) out.set(r.recipient_user_id, (out.get(r.recipient_user_id) ?? 0) + 1);
  return out;
}

export type InsertedInsight = { id: string; recipient_user_id: string; kind: string; severity: InsightSeverity; title: string; why: string; href: string; dedupe_key: string };

/**
 * Toplu ekleme: (tenant_id, recipient_user_id, dedupe_key) çakışırsa satıra DOKUNULMAZ (ignoreDuplicates):
 * yoksayılmış/ertelenmiş/uygulanmış içgörü yeniden açılmaz, aynı olay iki kez içgörü üretmez.
 * Yalnız GERÇEKTEN eklenen satırlar döner (bildirim tek kez düşsün diye).
 */
export async function insertInsights(admin: SupabaseClient, rows: readonly InsightRow[]): Promise<InsertedInsight[]> {
  if (rows.length === 0) return [];
  const inserted: InsertedInsight[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { data, error } = await admin
      .from("insights")
      .upsert(chunk, { onConflict: "tenant_id,recipient_user_id,dedupe_key", ignoreDuplicates: true })
      .select("id, recipient_user_id, kind, severity, title, why, href, dedupe_key");
    if (error) {
      if (isMissingSchemaError(error)) throw new InsightsTableMissing();
      throw new Error(`insights(insert): ${error.code ?? "hata"}`);
    }
    inserted.push(...((data ?? []) as InsertedInsight[]));
  }
  return inserted;
}

export class InsightsTableMissing extends Error {
  constructor() {
    super("insights tablosu yok (migration uygulanmadı)");
    this.name = "InsightsTableMissing";
  }
}

export async function markNotified(admin: SupabaseClient, tenantId: string, ids: readonly string[], nowMs: number): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await admin
    .from("insights")
    .update({ notified_at: new Date(nowMs).toISOString() })
    .eq("tenant_id", tenantId)
    .in("id", [...ids]);
  if (error) throw new Error(`insights(notified_at): ${error.code ?? "hata"}`);
}

/** Süresi geçmiş/kapanmış satır temizliği (RPC yoksa 0). */
export async function runHousekeeping(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.rpc("insight_housekeeping", { p_closed_retention_days: 90, p_expired_grace_days: 7 });
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(`insight_housekeeping: ${error.code ?? "hata"}`);
  }
  return Number(data ?? 0) || 0;
}
