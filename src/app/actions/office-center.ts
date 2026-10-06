"use server";

import { revalidatePath } from "next/cache";
import { createAdvisor, type CreateAdvisorResult } from "@/app/app/ekip/invite-actions";
import { setModuleEnabled, type ModuleActionResult } from "@/app/actions/modules";
import { handoffMemberWorkload, updateTeamMember } from "@/app/actions/team";
import { setMemberTeam } from "@/app/actions/teams";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { notifyTenant } from "@/lib/notify";
import { definitionsFromSettings, definitionKeys, COMMISSION_KEYS, notifyWrites, SLA_KEYS, THRESHOLD_KEYS, toWrites, WEIGHT_KEYS, type DefinitionsSnapshot } from "@/lib/office-center/definitions";
import { buildLeague, computeTeamHealth, type LeagueEntry } from "@/lib/office-center/logic";
import { loadPropertyForAssign, rankForProperty } from "@/lib/office-center/smart-assign-load";
import { topSuggestions, toStoredScore, type SmartSuggestion } from "@/lib/office-center/smart-assign";
import { loadOfficeStatistics, loadUnassignedProperties } from "@/lib/office-center/store";
import type { OfficeStatistics, TeamHealth } from "@/lib/office-center/types";
import {
  alertThresholdSchema,
  assignFromPoolSchema,
  cancelAssignmentSchema,
  commissionDefinitionSchema,
  deactivateAdvisorSchema,
  firstIssue,
  moduleToggleSchema,
  notificationChannelSchema,
  quickInviteSchema,
  reassignSchema,
  slaDefinitionSchema,
  updateAdvisorSchema,
  uuidSchema,
  weightsSchema,
} from "@/lib/office-center/validators";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { requirePermission, type PermissionGate } from "@/lib/require-permission";
import { getSettings, getTenantSettingViews } from "@/lib/settings/read";
import { ASSIGN_SLA_HOURS_KEY, UNASSIGNED_ALERT_KEY } from "@/lib/settings/registry/tenant";
import type { SettingView } from "@/lib/settings/types";
import { writeSetting } from "@/lib/settings/write";
import { createClient } from "@/lib/supabase/server";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { HANDOFF_SCOPES } from "@/lib/team/handoff";

/**
 * Ofis Merkezi sunucu eylemleri. Her eylem `requirePermission("office_center", ...)` kapısından geçer ve zod ile doğrular.
 * service_role YOK: oturumlu (RLS) istemci; kimlik/rol/pasife alma gibi ayrıcalıklı işler MEVCUT ekip eylemlerine
 * (createAdvisor, updateTeamMember, setMemberTeam, handoffMemberWorkload) delege edilir; onların kapıları ayrıca çalışır.
 * Şube müdürü (office_center edit, create yok) yalnız kendi şubesine atama yapar.
 */
export type OfficeCenterResult = { ok?: boolean; error?: string; message?: string; warning?: string };

const PAGE = "/app/ofis-merkezi";
type OkGate = Extract<PermissionGate, { ok: true }>;

function revalidate(propertyId?: string) {
  revalidatePath(PAGE);
  revalidatePath("/app/ekip");
  revalidatePath("/app/ilan-havuzu");
  revalidatePath("/app/portfoyler");
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
}

/** Şube müdürü kısıtı: kendi şubesi (yoksa null = ofis geneli roller). */
async function branchScope(gate: OkGate): Promise<{ branchId: string | null; error?: string }> {
  if (gate.role !== "branch_manager") return { branchId: null };
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("branch_id").eq("id", gate.userId).eq("tenant_id", gate.tenantId).maybeSingle();
  const branchId = (data as { branch_id?: string | null } | null)?.branch_id ?? null;
  if (!branchId) return { branchId: null, error: "Şube müdürü hesabınıza şube atanmamış; ofis sahibi önce şubenizi belirlemeli." };
  return { branchId };
}

async function safeNotify(input: Parameters<typeof notifyTenant>[0]) {
  try {
    await notifyTenant(input);
  } catch (e) {
    // dedupe_key sütunu yoksa (migration 001500) anahtarsız tek deneme; yine olmazsa iş akışı bozulmaz.
    if (input.dedupeKey) {
      try {
        await notifyTenant({ ...input, dedupeKey: undefined });
        return;
      } catch (e2) {
        console.error("office-center notify", e2);
        return;
      }
    }
    console.error("office-center notify", e);
  }
}

/* ========================================================================== */
/* DANIŞMAN YÖNETİMİ                                                             */
/* ========================================================================== */

/** Hızlı davet: hesap açma + rol/şube/koltuk doğrulaması + e-posta daveti MEVCUT `createAdvisor` akışıdır. */
export async function addAdvisor(input: unknown): Promise<CreateAdvisorResult> {
  const gate = await requirePermission("office_center", "create");
  if (!gate.ok) return { error: gate.error };
  const parsed = quickInviteSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const fd = new FormData();
  fd.set("full_name", v.fullName);
  fd.set("email", v.email);
  fd.set("phone", v.phone);
  fd.set("title", v.title);
  fd.set("role", v.role);
  fd.set("branch_id", v.branchId);
  fd.set("invite_mode", "email");
  const res = await createAdvisor(fd);
  if (res.ok) revalidate();
  return res;
}

/** Rol / şube / takım değişikliği (kimlik senkronu ve rol kuralı `updateTeamMember` + `setMemberTeam` içindedir). */
export async function updateAdvisor(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = updateAdvisorSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const scope = await branchScope(gate);
  if (scope.error) return { error: scope.error };
  if (scope.branchId && v.branchId !== undefined && v.branchId !== scope.branchId) return { error: "Şube müdürü üyeyi başka şubeye taşıyamaz." };

  const changed: string[] = [];
  if (v.role !== undefined || v.branchId !== undefined) {
    const fd = new FormData();
    fd.set("id", v.advisorId);
    if (v.role !== undefined) fd.set("role", v.role);
    if (v.branchId !== undefined) fd.set("branch_id", v.branchId);
    const res = await updateTeamMember(fd);
    if (res.error) return { error: res.error };
    if (v.role !== undefined) changed.push("rol");
    if (v.branchId !== undefined) changed.push("şube");
  }
  if (v.teamId !== undefined) {
    const fd = new FormData();
    fd.set("member_id", v.advisorId);
    fd.set("team_id", v.teamId);
    const res = await setMemberTeam(fd);
    if (res.error) return { error: res.error };
    changed.push("takım");
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "office_center.advisor_update", entityType: "profile", entityId: v.advisorId, newValue: { role: v.role ?? null, branch_id: v.branchId ?? null, team_id: v.teamId ?? null } });
  revalidate();
  return { ok: true, message: `${changed.join(", ")} güncellendi.` };
}

/**
 * Pasife alma (SİLME YOK): isteğe bağlı iş yükü devri (müşteri, portföy, açık anlaşma, açık görev, yaklaşan randevu)
 * sonra hesap pasif + oturumlar kapanır (`updateTeamMember` is_active=false). Devir başarısızsa pasife ALINMAZ.
 */
export async function deactivateAdvisor(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = deactivateAdvisorSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  if (v.advisorId === gate.userId) return { error: "Kendinizi pasife alamazsınız." };

  let handoffNote = "";
  if (v.handoffTo) {
    const fd = new FormData();
    fd.set("from", v.advisorId);
    fd.set("to", v.handoffTo);
    fd.set("reason", v.reason);
    for (const sc of HANDOFF_SCOPES) fd.set(`scope_${sc}`, "1");
    const res = await handoffMemberWorkload(fd);
    if (res.error) return { error: res.error };
    const moved = Object.values(res.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    handoffNote = ` İş yükü devredildi (${moved} kayıt).`;
  }
  const fd = new FormData();
  fd.set("id", v.advisorId);
  fd.set("is_active", "false");
  const res = await updateTeamMember(fd);
  if (res.error) return { error: `${res.error}${handoffNote ? ` Not: devir tamamlandı, hesap aktif kaldı.` : ""}` };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "office_center.advisor_deactivate", entityType: "profile", entityId: v.advisorId, newValue: { handoff_to: v.handoffTo || null, reason: v.reason || null } });
  revalidate();
  return { ok: true, message: `Danışman pasife alındı.${handoffNote}` };
}

export async function reactivateAdvisor(advisorId: string): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = uuidSchema.safeParse(advisorId);
  if (!id.success) return { error: firstIssue(id.error) };
  const fd = new FormData();
  fd.set("id", id.data);
  fd.set("is_active", "true");
  const res = await updateTeamMember(fd);
  if (res.error) return { error: res.error };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "office_center.advisor_reactivate", entityType: "profile", entityId: id.data });
  revalidate();
  return { ok: true, message: "Danışman yeniden aktif." };
}

/* ========================================================================== */
/* HAVUZDAN ATAMA                                                                */
/* ========================================================================== */

export type SuggestResult = { suggestions?: SmartSuggestion[]; excludedCount?: number; error?: string };

/** "Akıllı öner": ilk 3 uygun danışman, gerekçe satırlarıyla (ağırlıklar ofis ayarı; şube müdürü yalnız kendi şubesi). */
export async function suggestAssignees(propertyId: string): Promise<SuggestResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = uuidSchema.safeParse(propertyId);
  if (!id.success) return { error: firstIssue(id.error) };
  const scope = await branchScope(gate);
  if (scope.error) return { error: scope.error };
  const supabase = await createClient();
  const property = await loadPropertyForAssign(supabase, gate.tenantId, id.data);
  if (!property) return { error: "İlan bulunamadı." };
  if (scope.branchId && property.branchId && property.branchId !== scope.branchId) return { error: "Bu ilan başka şubeye ait." };
  const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  const { ranked } = await rankForProperty(supabase, gate.tenantId, { userId: gate.userId, role: gate.role, perms }, property, now(), scope.branchId);
  return { suggestions: topSuggestions(ranked), excludedCount: ranked.filter((r) => r.excluded).length };
}

type AssignCore = { propertyId: string; advisorId: string; method: "manual" | "smart"; reason: string; previousAssignee?: string | null };

/**
 * Atamanın çekirdeği: havuz kaydı varsa `assign_pool_entry` RPC (atomik: properties.assigned_to + havuz kapanış + olay),
 * yoksa properties.assigned_to doğrudan (RLS). Sonra pool_assignments geçmişi (önceki aktif -> reassigned) + bildirim.
 */
async function assignCore(gate: OkGate, v: AssignCore): Promise<OfficeCenterResult & { assignmentId?: string }> {
  const scope = await branchScope(gate);
  if (scope.error) return { error: scope.error };
  const supabase = await createClient();
  const property = await loadPropertyForAssign(supabase, gate.tenantId, v.propertyId);
  if (!property) return { error: "İlan bulunamadı." };
  if (scope.branchId && property.branchId && property.branchId !== scope.branchId) return { error: "Bu ilan başka şubeye ait." };

  const { data: target } = await supabase.from("profiles").select("id, full_name, role, is_active, branch_id").eq("id", v.advisorId).eq("tenant_id", gate.tenantId).maybeSingle();
  const t = target as { full_name: string; role: string; is_active: boolean; branch_id: string | null } | null;
  if (!t || !t.is_active) return { error: "Atanacak danışman bu ofiste aktif değil." };
  if (!["owner", "gm", "branch_manager", "team_lead", "advisor"].includes(t.role)) return { error: "Bu role ilan atanamaz." };
  if (scope.branchId && t.branch_id !== scope.branchId) return { error: "Şube müdürü yalnız kendi şubesindeki danışmana atayabilir." };
  if (property.assignedTo === v.advisorId) return { error: "İlan zaten bu danışmanda." };

  // Puan: akıllı yöntemde seçilen adayın gerekçesi saklanır (kişisel veri yok).
  let stored: ReturnType<typeof toStoredScore> | Record<string, never> = {};
  if (v.method === "smart") {
    const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
    const { ranked } = await rankForProperty(supabase, gate.tenantId, { userId: gate.userId, role: gate.role, perms }, property, now(), scope.branchId);
    const pick = ranked.find((r) => r.profileId === v.advisorId);
    if (pick?.excluded) return { error: `Bu danışman akıllı atamada elendi: ${pick.excluded.reason}. Yine de atamak için "elle ata" kullanın.` };
    if (pick) stored = toStoredScore(pick);
  }

  // 1) Havuz kaydı varsa RPC ile atomik atama; yoksa doğrudan sütun.
  const { data: entry } = await supabase.from("listing_pool_entries").select("id, status").eq("tenant_id", gate.tenantId).eq("property_id", v.propertyId).eq("status", "pending").maybeSingle();
  const entryId = (entry as { id?: string } | null)?.id ?? null;
  if (entryId) {
    const { error } = await supabase.rpc("assign_pool_entry", {
      p_entry_id: entryId,
      p_profile_id: v.advisorId,
      p_method: v.method === "smart" ? "suggested" : "manual",
      p_reason: v.reason || (v.method === "smart" ? "Ofis Merkezi akıllı atama" : "Ofis Merkezi elle atama"),
      p_score: "total" in stored ? stored.total : null,
      p_detail: { source: "office_center" },
    });
    if (error) return { error: ["22023", "42501", "P0002"].includes(String(error.code)) && error.message ? error.message : "Atama yapılamadı." };
  } else {
    const { data, error } = await supabase.from("properties").update({ assigned_to: v.advisorId }).eq("id", v.propertyId).eq("tenant_id", gate.tenantId).is("deleted_at", null).select("id");
    if (error || !data?.length) return { error: "İlan güncellenemedi (yetki veya kayıt sorunu)." };
  }

  // 2) Geçmiş: önceki aktif satır(lar) 'reassigned', yeni satır 'active'. Tablo yoksa atama yine geçerli, uyarı döner.
  let warning: string | undefined;
  let assignmentId: string | undefined;
  const prevUpdate = await supabase
    .from("pool_assignments")
    .update({ status: "reassigned" })
    .eq("tenant_id", gate.tenantId)
    .eq("property_id", v.propertyId)
    .eq("status", "active");
  if (prevUpdate.error && isMissingSchemaError(prevUpdate.error)) {
    warning = "Atama yapıldı; atama geçmişi tablosu henüz uygulanmadığı için geçmişe yazılamadı.";
  } else {
    const { data, error } = await supabase
      .from("pool_assignments")
      .insert({
        tenant_id: gate.tenantId,
        property_id: v.propertyId,
        from_pool_id: entryId,
        assigned_to: v.advisorId,
        previous_assignee: v.previousAssignee ?? property.assignedTo,
        assigned_by: gate.userId,
        method: v.method,
        score: stored,
        reason: v.reason || null,
        status: "active",
      })
      .select("id")
      .single();
    if (error) {
      console.error("pool_assignments insert", { code: error.code });
      warning = "Atama yapıldı ancak geçmiş kaydı yazılamadı.";
    } else assignmentId = String((data as { id: string }).id);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "office_center.assign",
    entityType: "property",
    entityId: v.propertyId,
    oldValue: { assigned_to: property.assignedTo },
    newValue: { assigned_to: v.advisorId, method: v.method, pool_entry: entryId, assignment_id: assignmentId ?? null, score: "total" in stored ? stored.total : null },
  });
  if (v.advisorId !== gate.userId) {
    await safeNotify({
      tenantId: gate.tenantId,
      userId: v.advisorId,
      title: `Sana yeni ilan atandı: ${property.title}`,
      body: v.method === "smart" ? "Ofis Merkezi akıllı atama ile seçildin. İlanı inceleyip yayına hazırla." : "Ofis Merkezi'nden atandı. İlanı inceleyip yayına hazırla.",
      href: `/app/portfoyler/${v.propertyId}`,
      kind: "success",
      dedupeKey: assignmentId ? `oc-assign:${assignmentId}` : undefined,
    });
  }
  revalidate(v.propertyId);
  return { ok: true, message: `${property.title} → ${t.full_name} atandı.`, warning, assignmentId };
}

/** Havuzdan/atanmamış ilanı danışmana ata (method: smart = öneri kartından, manual = elle seçim). */
export async function assignFromPool(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = assignFromPoolSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return assignCore(gate, parsed.data);
}

/** Atamayı iptal et: geçmiş satırı 'cancelled', ilan yeniden danışmansız (yalnız hâlâ o danışmandaysa), danışmana bildirim. */
export async function cancelAssignment(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = cancelAssignmentSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("pool_assignments").select("id, property_id, assigned_to, status").eq("id", v.assignmentId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (error) return { error: isMissingSchemaError(error) ? "Atama geçmişi henüz etkin değil." : "Atama okunamadı." };
  const row = data as { property_id: string; assigned_to: string; status: string } | null;
  if (!row) return { error: "Atama kaydı bulunamadı." };
  if (row.status !== "active") return { error: "Yalnız aktif atama iptal edilir." };
  const scope = await branchScope(gate);
  if (scope.error) return { error: scope.error };
  if (scope.branchId) {
    const { data: adv } = await supabase.from("profiles").select("branch_id").eq("id", row.assigned_to).eq("tenant_id", gate.tenantId).maybeSingle();
    if ((adv as { branch_id?: string | null } | null)?.branch_id !== scope.branchId) return { error: "Bu atama başka şubeye ait." };
  }

  const nowIso = new Date(now()).toISOString();
  const upd = await supabase
    .from("pool_assignments")
    .update({ status: "cancelled", cancelled_at: nowIso, cancelled_by: gate.userId, cancel_reason: v.reason })
    .eq("id", v.assignmentId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .select("id");
  if (upd.error || !upd.data?.length) return { error: "Atama iptal edilemedi." };
  // İlan hâlâ bu danışmandaysa danışmansız bırak (başkasına geçmişse dokunma).
  const { data: prop } = await supabase.from("properties").update({ assigned_to: null }).eq("id", row.property_id).eq("tenant_id", gate.tenantId).eq("assigned_to", row.assigned_to).select("id, title, property_code");
  const title = (prop?.[0] as { title?: string | null; property_code?: string | null } | undefined)?.title ?? (prop?.[0] as { property_code?: string | null } | undefined)?.property_code ?? "İlan";
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "office_center.assign_cancel", entityType: "property", entityId: row.property_id, oldValue: { assigned_to: row.assigned_to }, newValue: { assignment_id: v.assignmentId, reason: v.reason, unassigned: Boolean(prop?.length) } });
  if (row.assigned_to !== gate.userId) {
    await safeNotify({ tenantId: gate.tenantId, userId: row.assigned_to, title: `İlan ataması iptal edildi: ${title}`, body: v.reason, href: PAGE, kind: "warning", dedupeKey: `oc-cancel:${v.assignmentId}` });
  }
  revalidate(row.property_id);
  return { ok: true, message: prop?.length ? "Atama iptal edildi; ilan yeniden danışmansız." : "Atama iptal edildi (ilan bu arada başka danışmana geçmişti; dokunulmadı)." };
}

/** Yeniden ata: aktif atamayı 'reassigned' yapıp yeni danışmana elle atar. */
export async function reassignAssignment(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = reassignSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("pool_assignments").select("id, property_id, assigned_to, status").eq("id", v.assignmentId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (error) return { error: isMissingSchemaError(error) ? "Atama geçmişi henüz etkin değil." : "Atama okunamadı." };
  const row = data as { property_id: string; assigned_to: string; status: string } | null;
  if (!row) return { error: "Atama kaydı bulunamadı." };
  if (row.status !== "active") return { error: "Yalnız aktif atama yeniden atanır." };
  if (row.assigned_to === v.advisorId) return { error: "İlan zaten bu danışmanda." };
  return assignCore(gate, { propertyId: row.property_id, advisorId: v.advisorId, method: "manual", reason: v.reason || "Yeniden atama", previousAssignee: row.assigned_to });
}

/* ========================================================================== */
/* AYARLAR / TANIMLAMALAR                                                        */
/* ========================================================================== */

/** Ofis ayar görünümleri (değer, varsayılan, değişti mi) — Ayarlar sekmesi. */
export async function getOfficeSettings(): Promise<{ views: SettingView[]; error?: string }> {
  const gate = await requirePermission("office_center", "view");
  if (!gate.ok) return { views: [], error: gate.error };
  return { views: await getTenantSettingViews(gate.tenantId) };
}

/** Tipli tanımlama anlık görüntüsü — Tanımlamalar formlarının başlangıcı. */
export async function getDefinitions(): Promise<{ definitions?: DefinitionsSnapshot; error?: string }> {
  const gate = await requirePermission("office_center", "view");
  if (!gate.ok) return { error: gate.error };
  return { definitions: definitionsFromSettings(await getSettings(definitionKeys(), { tenantId: gate.tenantId })) };
}

/**
 * Toplu yazım: her anahtar registry'de ofis kapsamlı olmalı; `writeSetting` doğrulama + geçmiş + `settings:edit` kapısını
 * uygular (ayar yetkisi ayrı modüldür; office_center edit tek başına yetmez — tek kapı korunur).
 */
async function writeMany(gate: OkGate, writes: { key: string; value: string }[], reason: string): Promise<OfficeCenterResult> {
  let changed = 0;
  for (const w of writes) {
    const res = await writeSetting({ key: w.key, value: w.value, scope: "tenant", reason });
    if (!res.ok) return { error: res.error };
    if (res.changed) changed++;
  }
  if (changed) {
    await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "office_center.settings", entityType: "tenant", entityId: gate.tenantId, newValue: { keys: writes.map((w) => w.key), reason } });
    for (const p of [PAGE, "/app/ayarlar/merkez", "/app/anlasmalar", "/app/talepler", "/app/komisyon", "/app/raporlar/lead-hizi", "/app/ayarlar"]) revalidatePath(p);
  }
  return { ok: true, message: changed ? `${changed} tanım güncellendi.` : "Değişiklik yok." };
}

export async function saveOfficeSettings(input: unknown, reason?: string): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!Array.isArray(input) || input.length === 0 || input.length > 60) return { error: "Kaydedilecek ayar yok." };
  const writes: { key: string; value: string }[] = [];
  for (const it of input as unknown[]) {
    const o = it as { key?: unknown; value?: unknown };
    if (typeof o?.key !== "string" || !o.key.startsWith("office.")) return { error: "Yalnız ofis ayarları kaydedilebilir." };
    writes.push({ key: o.key, value: String(o.value ?? "") });
  }
  return writeMany(gate, writes, String(reason ?? "Ofis Merkezi"));
}

export async function saveSLADefinition(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = slaDefinitionSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return writeMany(gate, toWrites(SLA_KEYS, parsed.data), "Ofis Merkezi > Tanımlamalar > SLA");
}

export async function saveCommissionDefinition(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = commissionDefinitionSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return writeMany(gate, toWrites(COMMISSION_KEYS, parsed.data), "Ofis Merkezi > Tanımlamalar > Komisyon");
}

export async function saveAlertThresholds(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = alertThresholdSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return writeMany(gate, toWrites(THRESHOLD_KEYS, parsed.data), "Ofis Merkezi > Tanımlamalar > Uyarı eşikleri");
}

export async function saveNotificationChannels(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = notificationChannelSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const writes = notifyWrites(parsed.data);
  if (!writes.length) return { error: "Bilinen bildirim kanalı yok." };
  return writeMany(gate, writes, "Ofis Merkezi > Tanımlamalar > Bildirim kanalları");
}

export async function saveAssignWeights(input: unknown): Promise<OfficeCenterResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = weightsSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (Object.values(parsed.data).every((v) => v === 0)) return { error: "En az bir ölçütün ağırlığı 0'dan büyük olmalı." };
  return writeMany(gate, toWrites(WEIGHT_KEYS, parsed.data), "Ofis Merkezi > Tanımlamalar > Akıllı atama ağırlıkları");
}

/** Modül kısa yolu: aç/kapa kararı ve kuralları `setModuleEnabled` (owner/gm, bağımlılık, plan/platform kilidi) içindedir. */
export async function toggleModuleFromOfficeCenter(input: unknown): Promise<ModuleActionResult> {
  const gate = await requirePermission("office_center", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = moduleToggleSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await setModuleEnabled(parsed.data.moduleKey, parsed.data.enabled, parsed.data.cascade);
  if (res.ok) revalidatePath(PAGE);
  return res;
}

/* ========================================================================== */
/* İSTATİSTİKLER                                                                 */
/* ========================================================================== */

export async function getOfficeStats(): Promise<{ stats?: OfficeStatistics; error?: string }> {
  const gate = await requirePermission("office_center", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  return { stats: await loadOfficeStatistics(supabase, gate.tenantId, now()) };
}

/** Danışman ligi (bu TR ayı). Bireysel kazanç yalnız `earnings_all` izni olanlara (owner/gm) döner. */
export async function getAdvisorPerformanceLeague(): Promise<{ league: LeagueEntry[]; seeAllEarnings: boolean; sampleLabel: string | null; failed: boolean; error?: string }> {
  const gate = await requirePermission("office_center", "view");
  if (!gate.ok) return { league: [], seeAllEarnings: false, sampleLabel: null, failed: false, error: gate.error };
  const supabase = await createClient();
  const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  const nowMs = now();
  const res = await loadAdvisorMetrics(supabase, { viewer: { userId: gate.userId, role: gate.role, perms }, tenantId: gate.tenantId, period: currentMonthPeriod(nowMs), nowMs });
  const seeAll = canSeeAllEarnings(perms);
  return { league: buildLeague(res.rows, { viewerId: gate.userId, seeAllEarnings: seeAll }), seeAllEarnings: seeAll, sampleLabel: res.sampleLabel, failed: res.failed };
}

export async function getTeamHealth(): Promise<{ health?: TeamHealth; error?: string }> {
  const gate = await requirePermission("office_center", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const nowMs = now();
  const settings = await getSettings([ASSIGN_SLA_HOURS_KEY, UNASSIGNED_ALERT_KEY], { tenantId: gate.tenantId });
  const [stats, unassigned] = await Promise.all([
    loadOfficeStatistics(supabase, gate.tenantId, nowMs),
    loadUnassignedProperties(supabase, gate.tenantId, { nowMs, slaHours: Number(settings[ASSIGN_SLA_HOURS_KEY] ?? 24), limit: 1 }),
  ]);
  return { health: computeTeamHealth({ stats, breachedUnassigned: unassigned.breached, unassignedThreshold: Number(settings[UNASSIGNED_ALERT_KEY] ?? 5), advisorsWithoutActivity30d: 0 }) };
}
