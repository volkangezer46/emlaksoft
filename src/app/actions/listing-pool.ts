"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { revalidateTenantData } from "@/lib/revalidate";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { now } from "@/lib/clock";
import { isPoolMode } from "@/lib/pool/modes";
import { notifyPoolAssigned, notifyPoolEntry } from "@/lib/pool/notify";
import { computeSuggestions, loadPoolRule, toPoolProperty } from "@/lib/pool/server";
import { toStoredSuggestions } from "@/lib/pool/score";
import { actionErrorMessage, sqlRaiseMessage } from "@/lib/action-errors";

export type PoolActionResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL_METHODS = ["manual", "suggested", "reassign"] as const;

type EntryRow = {
  id: string;
  property_id: string;
  status: string;
  source: string;
  rule_id: string | null;
  suggestions: { profile_id: string; score: number }[] | null;
};

const PROPERTY_COLUMNS = "id, property_code, title, property_type, transaction_type, province_id, district_id, neighborhood_id, list_price";

function revalidatePool(tenantId: string, propertyId?: string) {
  revalidatePath("/app/ilan-havuzu");
  revalidatePath("/app/portfoyler");
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidateTenantData(tenantId);
}

/** RPC'nin kendi (Türkçe, kullanıcıya dönük) hata iletilerini geçirir; diğerlerini genelleştirir. */
function rpcMessage(error: { code?: string; message?: string }): string {
  return sqlRaiseMessage(error, ["22023", "42501", "P0002"]) ??
    actionErrorMessage(error, "Atama yapılamadı. Lütfen tekrar deneyin.");
}

async function loadEntry(entryId: string, tenantId: string): Promise<EntryRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("listing_pool_entries")
    .select("id, property_id, status, source, rule_id, suggestions")
    .eq("id", entryId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as EntryRow | null) ?? null;
}

async function propertyLabel(tenantId: string, propertyId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("properties").select("title, property_code").eq("id", propertyId).eq("tenant_id", tenantId).maybeSingle();
  const row = data as { title?: string | null; property_code?: string | null } | null;
  return row?.title || row?.property_code || "İlan";
}

/** Yönetici ataması (manuel / önerilen / yeniden atama). Atomik: assign_pool_entry RPC. */
export async function assignPoolEntry(entryId: string, profileId: string, method: string, reason?: string): Promise<PoolActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!hasOfficeWideDataScope(gate.role)) return { error: "Atamayı yalnız ofis yönetimi yapabilir." };
  if (!UUID_RE.test(entryId) || !UUID_RE.test(profileId)) return { error: "Geçersiz kayıt." };
  if (!(MANUAL_METHODS as readonly string[]).includes(method)) return { error: "Geçersiz atama yöntemi." };

  const entry = await loadEntry(entryId, gate.tenantId);
  if (!entry) return { error: "Havuz kaydı bulunamadı." };
  const score = entry.suggestions?.find((s) => s.profile_id === profileId)?.score ?? null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_pool_entry", {
    p_entry_id: entryId,
    p_profile_id: profileId,
    p_method: method,
    p_reason: reason?.trim().slice(0, 500) || null,
    p_score: score,
    p_detail: {},
  });
  if (error) return { error: rpcMessage(error) };

  const label = await propertyLabel(gate.tenantId, entry.property_id);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "listing_pool.assign",
    entityType: "property",
    entityId: entry.property_id,
    newValue: { entry_id: entryId, assigned_to: profileId, method },
  });
  await notifyPoolAssigned(supabase, { tenantId: gate.tenantId, actorId: gate.userId, assigneeId: profileId, propertyId: entry.property_id, label, method });
  revalidatePool(gate.tenantId, entry.property_id);
  return { ok: true };
}

/** Sahiplenme: danışman kendine alır (yalnız sahiplenme penceresi açıkken; RPC doğrular, ilk alan kazanır). */
export async function claimPoolEntry(entryId: string): Promise<PoolActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(entryId)) return { error: "Geçersiz kayıt." };
  const entry = await loadEntry(entryId, gate.tenantId);
  if (!entry) return { error: "Havuz kaydı bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_pool_entry", {
    p_entry_id: entryId,
    p_profile_id: gate.userId,
    p_method: "claim",
    p_reason: "Danışman sahiplendi.",
    p_score: entry.suggestions?.find((s) => s.profile_id === gate.userId)?.score ?? null,
    p_detail: {},
  });
  if (error) {
    const msg = String(error.message ?? "");
    if (/zaten atanmis|kapanmis/i.test(msg)) return { error: "Bu ilan başka bir danışman tarafından sahiplenildi." };
    return { error: rpcMessage(error) };
  }
  const label = await propertyLabel(gate.tenantId, entry.property_id);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "listing_pool.claim",
    entityType: "property",
    entityId: entry.property_id,
    newValue: { entry_id: entryId },
  });
  await notifyPoolAssigned(supabase, { tenantId: gate.tenantId, actorId: gate.userId, assigneeId: gate.userId, propertyId: entry.property_id, label, method: "claim" });
  revalidatePool(gate.tenantId, entry.property_id);
  return { ok: true };
}

/** Havuzdan çıkarma/atlama: ilan atanmadan kalır; gerekçe zorunlu ve olay geçmişine yazılır. */
export async function skipPoolEntry(entryId: string, reason: string): Promise<PoolActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!hasOfficeWideDataScope(gate.role)) return { error: "Yalnız ofis yönetimi havuz kaydını atlayabilir." };
  if (!UUID_RE.test(entryId)) return { error: "Geçersiz kayıt." };
  const why = reason.trim();
  if (why.length < 3) return { error: "Atlama gerekçesi zorunlu (en az 3 karakter)." };
  const entry = await loadEntry(entryId, gate.tenantId);
  if (!entry) return { error: "Havuz kaydı bulunamadı." };
  if (entry.status !== "pending") return { error: "Yalnız bekleyen kayıt atlanabilir." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listing_pool_entries")
    .update({ status: "skipped", skip_reason: why.slice(0, 500), claim_open_until: null })
    .eq("id", entryId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id");
  if (error || !data?.length) return { error: actionErrorMessage(error, "Kayıt güncellenemedi.") };
  await supabase.from("listing_pool_events").insert({
    tenant_id: gate.tenantId,
    entry_id: entryId,
    event: "skipped",
    actor_id: gate.userId,
    reason: why.slice(0, 500),
    detail: {},
  });
  revalidatePool(gate.tenantId, entry.property_id);
  return { ok: true };
}

/** Öneri listesini güncel uzmanlık/iş yüküyle yeniden hesaplar. */
export async function refreshPoolSuggestions(entryId: string): Promise<PoolActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!hasOfficeWideDataScope(gate.role)) return { error: "Yalnız ofis yönetimi önerileri yenileyebilir." };
  if (!UUID_RE.test(entryId)) return { error: "Geçersiz kayıt." };
  const entry = await loadEntry(entryId, gate.tenantId);
  if (!entry || entry.status !== "pending") return { error: "Bekleyen havuz kaydı bulunamadı." };

  const supabase = await createClient();
  const { data: property } = await supabase.from("properties").select(PROPERTY_COLUMNS).eq("id", entry.property_id).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!property) return { error: "İlan bulunamadı." };
  const suggestions = await computeSuggestions(supabase, gate.tenantId, toPoolProperty(property as Record<string, unknown>), now(), entry.rule_id);
  const top = suggestions.find((s) => !s.excluded) ?? null;
  const { error } = await supabase
    .from("listing_pool_entries")
    .update({ suggestions: toStoredSuggestions(suggestions), top_score: top ? top.score : null, suggested_at: new Date(now()).toISOString() })
    .eq("id", entryId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending");
  if (error) return { error: actionErrorMessage(error, "Öneriler güncellenemedi.") };
  await supabase.from("listing_pool_events").insert({
    tenant_id: gate.tenantId,
    entry_id: entryId,
    event: "suggested",
    actor_id: gate.userId,
    score: top ? top.score : null,
    to_profile_id: top ? top.profileId : null,
    detail: { refreshed: true },
  });
  revalidatePath("/app/ilan-havuzu");
  return { ok: true };
}

/** Yönetici bekleyen ilan için sahiplenme penceresi açar (süre = kuralın SLA dakikası, yoksa 30 dk). */
export async function openPoolClaimWindow(entryId: string): Promise<PoolActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!hasOfficeWideDataScope(gate.role)) return { error: "Yalnız ofis yönetimi sahiplenme açabilir." };
  if (!UUID_RE.test(entryId)) return { error: "Geçersiz kayıt." };
  const entry = await loadEntry(entryId, gate.tenantId);
  if (!entry || entry.status !== "pending") return { error: "Bekleyen havuz kaydı bulunamadı." };

  const supabase = await createClient();
  const rule = await loadPoolRule(supabase, gate.tenantId, entry.source);
  const minutes = rule.slaMinutes && rule.slaMinutes > 0 ? rule.slaMinutes : 30;
  const until = new Date(now() + minutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("listing_pool_entries")
    .update({ claim_open_until: until })
    .eq("id", entryId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id");
  if (error || !data?.length) return { error: actionErrorMessage(error, "Sahiplenme açılamadı.") };
  await supabase.from("listing_pool_events").insert({
    tenant_id: gate.tenantId,
    entry_id: entryId,
    event: "claim_opened",
    actor_id: gate.userId,
    detail: { until, manual: true },
  });
  const stored = (entry.suggestions ?? []).map((s) => s.profile_id);
  const label = await propertyLabel(gate.tenantId, entry.property_id);
  await notifyPoolEntry(supabase, {
    tenantId: gate.tenantId,
    actorId: gate.userId,
    propertyId: entry.property_id,
    label,
    decision: { kind: "open_claim", claimOpenUntilMs: Date.parse(until), eligibleProfileIds: stored },
    claimProfileIds: stored,
  });
  revalidatePath("/app/ilan-havuzu");
  return { ok: true };
}

/** Havuz ayarı: aç/kapat + mod + eşik + SLA. Yalnız owner/gm. Kural satırı assignment_rules (target_kind='listing'). */
export async function saveListingPoolSettings(formData: FormData): Promise<PoolActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.role !== "owner" && gate.role !== "gm") return { error: "Havuz ayarlarını yalnız ofis sahibi ve genel müdür değiştirebilir." };

  const enabled = String(formData.get("enabled") ?? "") === "1";
  const modeRaw = String(formData.get("mode") ?? "semi_auto");
  if (!isPoolMode(modeRaw)) return { error: "Geçersiz atama modu." };
  const minRaw = String(formData.get("min_score") ?? "").trim();
  const slaRaw = String(formData.get("sla_minutes") ?? "").trim();
  const minScore = minRaw ? Number(minRaw) : null;
  const sla = slaRaw ? Number(slaRaw) : null;
  if (minScore != null && (!Number.isInteger(minScore) || minScore < 0 || minScore > 100)) return { error: "Asgari puan 0-100 arasında tam sayı olmalı." };
  if (sla != null && (!Number.isInteger(sla) || sla < 1 || sla > 10080)) return { error: "SLA süresi 1-10080 dakika arasında olmalı." };
  if (modeRaw === "claim" && sla == null) return { error: "Sahiplenme modu için süre (dakika) gerekli." };
  if (modeRaw === "auto" && minScore == null) return { error: "Otomatik mod için asgari puan gerekli." };

  const supabase = await createClient();
  const { data: tenantRow, error: tenantError } = await supabase
    .from("tenants")
    .update({ listing_pool_enabled: enabled })
    .eq("id", gate.tenantId)
    .select("id");
  if (tenantError || !tenantRow?.length) {
    return { error: "Havuz ayarı kaydedilemedi (veritabanı güncellemesi henüz uygulanmamış olabilir)." };
  }

  const { data: existing } = await supabase
    .from("assignment_rules")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("target_kind", "listing")
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();
  const patch = { assign_mode: modeRaw, min_score: minScore, sla_minutes: sla, is_active: true };
  const ruleError = existing
    ? (await supabase.from("assignment_rules").update(patch).eq("id", (existing as { id: string }).id).eq("tenant_id", gate.tenantId)).error
    : (
        await supabase
          .from("assignment_rules")
          .insert({ ...patch, tenant_id: gate.tenantId, name: "İlan havuzu", target_kind: "listing", priority: 100, strategy: "least_loaded", created_by: gate.userId })
      ).error;
  if (ruleError) {
    console.error("saveListingPoolSettings", { code: ruleError.code });
    return { error: actionErrorMessage(ruleError, "Atama kuralı kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "listing_pool.settings",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { enabled, mode: modeRaw, min_score: minScore, sla_minutes: sla },
  });
  revalidatePool(gate.tenantId);
  return { ok: true };
}
