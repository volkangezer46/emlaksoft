import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayStartIso } from "@/lib/clock";
import { SUPPRESSION_DAYS, suppressionKey } from "@/lib/insights/dedupe";
import type { RuleQualityRow } from "@/lib/insights/quality";
import { INSIGHT_EXCLUDED_ROLES, ruleBase, type InsightDraft, type InsightSeverity } from "@/lib/insights/types";
import { isMissingSchemaError } from "@/lib/insights/facts";
import { mergeEffectivePermissions, type EffectivePermissions, type RoleOverrideRow, type UserOverrideRow } from "@/lib/permissions-merge";

/**
 * Engine tarafı depo işlemleri (service_role istemcisi PARAMETRE olarak gelir; bu dosya istemci oluşturmaz).
 * Her sorgu AÇIK `tenant_id` filtresi taşır (service_role RLS'i atlar).
 */

export type Recipient = {
  id: string;
  role: string;
  /** Etkin izin (yalnız izin isteyen kural taslağı varsa yüklenir; yoksa izin isteyen içgörü bu alıcıya GİTMEZ). */
  perms?: EffectivePermissions;
};

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
  const { data, error } = await fetchAllRowsKeepError((from, to) =>
    admin.from("profiles").select("id, role").eq("tenant_id", tenantId).eq("is_active", true).order("id", { ascending: true }).range(from, to),
  );
  if (error) throw new Error(`profiles: ${error.code ?? "hata"}`);
  const excluded = new Set<string>(INSIGHT_EXCLUDED_ROLES);
  return ((data ?? []) as { id: string; role: string }[]).filter((p) => !excluded.has(p.role)).map((p) => ({ id: p.id, role: p.role }));
}

/**
 * Alıcıların ETKİN izinleri (SK6/B165): varsayılan matris + ofis rol istisnaları (tenant_role_permissions) + kullanıcı
 * istisnaları (user_permission_overrides); oturumdaki `getEffectivePermissions` ile aynı saf birleşim (`mergeEffectivePermissions`).
 * Katmanlar okunamazsa alıcılar izinsiz döner (izin isteyen içgörü kimseye gitmez; güvenli taraf).
 */
export async function attachRecipientPermissions(
  admin: SupabaseClient,
  tenantId: string,
  recipients: readonly Recipient[],
  nowMs: number,
): Promise<Recipient[]> {
  const [roleRes, userRes] = await Promise.all([
    fetchAllRowsKeepError((from, to) =>
      admin.from("tenant_role_permissions").select("role, module, action, allowed").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRowsKeepError((from, to) =>
      admin
        .from("user_permission_overrides")
        .select("user_id, module, actions, expires_at")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (roleRes.error || userRes.error) {
    console.error("insight-engine permissions", (roleRes.error ?? userRes.error)?.code ?? "hata");
    return recipients.map((r) => ({ id: r.id, role: r.role }));
  }
  const byRole = new Map<string, RoleOverrideRow[]>();
  for (const r of (roleRes.data ?? []) as (RoleOverrideRow & { role: string })[]) {
    const list = byRole.get(r.role) ?? [];
    list.push({ module: r.module, action: r.action, allowed: r.allowed });
    byRole.set(r.role, list);
  }
  const byUser = new Map<string, UserOverrideRow[]>();
  for (const r of (userRes.data ?? []) as (UserOverrideRow & { user_id: string })[]) {
    const list = byUser.get(r.user_id) ?? [];
    list.push({ module: r.module, actions: r.actions ?? [], expires_at: r.expires_at });
    byUser.set(r.user_id, list);
  }
  return recipients.map((r) => ({ id: r.id, role: r.role, perms: mergeEffectivePermissions(r.role, byRole.get(r.role) ?? [], byUser.get(r.id) ?? [], nowMs) }));
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
  const { data, error } = await fetchAllRowsKeepError((from, to) =>
    admin
      .from("insights")
      .select("recipient_user_id, rule_id, entity_id, state_reason, updated_at")
      .eq("tenant_id", tenantId)
      .eq("state", "dismissed")
      .gte("updated_at", since)
      .order("id", { ascending: true })
      .range(from, to),
  );
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
  const { data, error } = await fetchAllRowsKeepError((from, to) =>
    admin
      .from("insights")
      .select("recipient_user_id, dedupe_key")
      .eq("tenant_id", tenantId)
      .in("state", ["new", "seen", "snoozed"])
      .gt("valid_until", new Date(nowMs).toISOString())
      .order("id", { ascending: true })
      .range(from, to),
  );
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
  const { data, error } = await fetchAllRowsKeepError((from, to) =>
    admin
      .from("insights")
      .select("recipient_user_id")
      .eq("tenant_id", tenantId)
      .gte("notified_at", trDayStartIso(nowMs))
      .order("id", { ascending: true })
      .range(from, to),
  );
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

/**
 * DURUM tipi içgörüyü yeniler (SK6/B018): satırlar, alıcıda zaten AÇIK olan (tenant, alıcı, dedupe_key) üçlüsüdür. Çakışmada
 * yalnız taslaktan gelen sütunlar ve updated_at yazılır; state, state_reason, snoozed_until, notified_at, created_at KORUNUR.
 * Dönen satırlar bildirim için KULLANILMAZ (yeniden zil yok). Dönen: yenilenen satır sayısı.
 */
export async function refreshInsights(admin: SupabaseClient, rows: readonly InsightRow[], nowMs: number): Promise<number> {
  if (rows.length === 0) return 0;
  const updatedAt = new Date(nowMs).toISOString();
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, updated_at: updatedAt }));
    const { data, error } = await admin
      .from("insights")
      .upsert(chunk, { onConflict: "tenant_id,recipient_user_id,dedupe_key", ignoreDuplicates: false })
      .select("id");
    if (error) {
      if (isMissingSchemaError(error)) throw new InsightsTableMissing();
      throw new Error(`insights(refresh): ${error.code ?? "hata"}`);
    }
    n += (data ?? []).length;
  }
  return n;
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

/** SAF: açık satırlardan, canlı kümede OLMAYAN varlıkların satır kimlikleri (koşulu kalkanlar). entity_id'siz satıra dokunulmaz. */
export function selectStaleInsightIds(
  openRows: readonly { id: string; entity_id: string | null }[],
  liveEntityIds: ReadonlySet<string>,
): string[] {
  return openRows.filter((r) => r.entity_id && !liveEntityIds.has(r.entity_id)).map((r) => r.id);
}

/**
 * Koşulu kalkan içgörüleri kapatır (TEK yazıcı): bu kuralın AÇIK (new/seen/snoozed, süresi dolmamış; kullanıcı
 * yoksaymamış/uygulamamış) satırlarından varlığı bu turun canlı kümesinde olmayanların `valid_until`'i şimdiye çekilir.
 * `state` ve `state_reason` DEĞİŞMEZ (kalite sayaçları "yoksayıldı/uygulandı" ile kirlenmez). Yeniden koşul oluşursa yeni
 * dedupe dönemiyle yeni satır doğar. Dönen: kapatılan satır sayısı. Çağıran, kural hatasız ve bütçe içinde bittiyse çağırmalıdır.
 */
export async function expireStaleInsights(
  admin: SupabaseClient,
  tenantId: string,
  ruleId: string,
  liveEntityIds: ReadonlySet<string>,
  nowMs: number,
): Promise<number> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await fetchAllRowsKeepError((from, to) =>
    admin
      .from("insights")
      .select("id, entity_id")
      .eq("tenant_id", tenantId)
      .eq("rule_id", ruleId)
      .in("state", ["new", "seen", "snoozed"])
      .gt("valid_until", nowIso)
      .not("entity_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(`insights(stale): ${error.code ?? "hata"}`);
  }
  const staleIds = selectStaleInsightIds((data ?? []) as { id: string; entity_id: string | null }[], liveEntityIds);
  let closed = 0;
  for (let i = 0; i < staleIds.length; i += 200) {
    const chunk = staleIds.slice(i, i + 200);
    const { data: upd, error: uerr } = await admin
      .from("insights")
      .update({ valid_until: nowIso })
      .eq("tenant_id", tenantId)
      .eq("rule_id", ruleId)
      .in("state", ["new", "seen", "snoozed"])
      .in("id", chunk)
      .select("id");
    if (uerr) throw new Error(`insights(expire): ${uerr.code ?? "hata"}`);
    closed += (upd ?? []).length;
  }
  return closed;
}

/**
 * İzni olmayan alıcının açık içgörülerini kapatır (SK6/B165): izin isteyen kural (ör. bütçe → expenses:view) daha önce
 * izinsiz alıcıya (gider izni olmayan şube müdürü) dağıtılmış olabilir. Yalnız valid_until şimdiye çekilir; state değişmez.
 */
export async function expireInsightsForUsers(
  admin: SupabaseClient,
  tenantId: string,
  ruleId: string,
  userIds: readonly string[],
  nowMs: number,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await admin
    .from("insights")
    .update({ valid_until: nowIso })
    .eq("tenant_id", tenantId)
    .eq("rule_id", ruleId)
    .in("recipient_user_id", [...userIds])
    .in("state", ["new", "seen", "snoozed"])
    .gt("valid_until", nowIso)
    .select("id");
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(`insights(forbidden): ${error.code ?? "hata"}`);
  }
  return (data ?? []).length;
}

/**
 * Olay anında kapatma: müşteriyle temas (arama/iletişim kaydı) girildi → o müşterinin AÇIK "Bugün ara" kartları hemen
 * biter (motor turunu beklemez). `insights` tablosuna doğrudan yazma yalnız service_role'de olduğundan ve insights kodu
 * createAdminClient KULLANMADIĞINDAN (insights-contract.test.ts) bu, çağıranın OTURUMUYLA çalışan dar bir RPC'dir
 * (`insight_close_call_priority`, 20261012001600): ofis oturumdan çözülür, yalnız call_priority + açık satırlar,
 * yalnız valid_until yazılır (state/state_reason değişmez). RPC henüz yoksa 0 döner (öneri motor turunda kapanır).
 */
export async function closeCallPriorityForCustomer(client: SupabaseClient, customerId: string): Promise<number> {
  const { data, error } = await client.rpc("insight_close_call_priority", { p_customer_id: customerId });
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(`insight_close_call_priority: ${error.code ?? "hata"}`);
  }
  return Number(data ?? 0) || 0;
}

/**
 * FSBO (Sahibinden ilanlar) ilan kartı için olay anında kapatma (`insight_close_fsbo_lead`, 20261012002500): aynı dar desen,
 * yalnız o ilana bağlı açık call_priority satırlarının valid_until alanı yazılır. RPC yoksa 0 döner (motor turunda kapanır).
 */
export async function closeFsboLeadInsights(client: SupabaseClient, leadId: string): Promise<number> {
  const { data, error } = await client.rpc("insight_close_fsbo_lead", { p_lead_id: leadId });
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(`insight_close_fsbo_lead: ${error.code ?? "hata"}`);
  }
  return Number(data ?? 0) || 0;
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
