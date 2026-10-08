"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { now } from "@/lib/clock";
import { orIlike, safeLike } from "@/lib/pgrst";
import type { AppRole } from "@/lib/permissions";
import {
  OVERRIDE_RESOURCE_LABELS,
  OVERRIDE_RESOURCE_TYPES,
  canChangeScope,
  canCreateOverride,
  isScopeEditorRole,
  normalizeScopeInput,
  type ScopeInput,
} from "@/lib/access-control/admin-rules";
import { recordAccessAudit } from "@/lib/access-control/audit";
import { ASSIGNABLE_SCOPES, SCOPE_LABELS, defaultUserScopeForRole } from "@/lib/access-control/scope-rules";
import { applyAccessAuditFilters, normalizeAccessAuditFilters, type AccessAuditFilters } from "@/lib/access-control/audit-filters";
import type { ScopeOverride } from "@/lib/access-control/types";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Yetkilendirme yönetimi (/app/ayarlar/yetkilendirme) sunucu eylemleri.
 *
 * Kapı: her yazma `requirePermission("settings","edit")` + owner/gm (PERMISSION_EDITOR_ROLES; `roles` adlı ayrı
 * modül yok, roller ekranıyla aynı kapı). Okuma: `settings:view`. Kurallar saf `admin-rules.ts`'te (kendini yükseltme
 * yasağı, ofis sahibi kapsamı yalnız ofis sahibi, owner/gm office altına inmez). Her yazma `access_audit_log`'a
 * önce/sonra ile kayıt düşer; denetim satırı yazılamazsa değişiklik geri çevrilir (kayıtsız yetki değişikliği yok).
 * Tenant eşitliği: hedef profil oturumun ofisinde olmalı; tenant_id istemciden alınmaz.
 */

export type AccessControlResult = { ok?: boolean; error?: string };

const PATH = "/app/ayarlar/yetkilendirme";
const UUID = z.string().uuid();
const MISSING_SCHEMA = new Set(["42P01", "PGRST205", "PGRST204"]);
const SCHEMA_ERROR = "Yetkilendirme şeması bu ortamda henüz uygulanmadı (migration 20261006000100-104).";

function revalidate() {
  revalidatePath(PATH);
  revalidatePath("/app");
}

async function requireScopeEditor() {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error } as const;
  if (!isScopeEditorRole(gate.role)) return { error: "Bu işlem için yetkiniz yok. Yalnız ofis sahibi ve genel müdür yetkilendirme yapabilir." } as const;
  const supabase = await createClient();
  return { supabase, tenantId: gate.tenantId, userId: gate.userId, role: gate.role } as const;
}

type Editor = Exclude<Awaited<ReturnType<typeof requireScopeEditor>>, { error: string }>;

/** Hedef üye: aynı ofiste ve aktif olmalı. */
async function loadTarget(ctx: Editor, userId: string) {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("id, tenant_id, role, full_name, is_active, branch_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Üye okunamadı.") } as const;
  if (!data || data.tenant_id !== ctx.tenantId) return { error: "Üye bu ofise ait değil." } as const;
  return { target: data as { id: string; tenant_id: string; role: string; full_name: string; is_active: boolean; branch_id: string | null } } as const;
}

function schemaOrGeneric(error: { code?: string } | null, generic: string): string {
  return error && MISSING_SCHEMA.has(String(error.code)) ? SCHEMA_ERROR : actionErrorMessage(error, generic);
}

// ───────────────────────── Kapsam (user_scopes) ─────────────────────────

const scopeSchema = z.object({
  userId: UUID,
  scope_type: z.enum(["user", "team", "branch", "office"]),
  team_id: UUID.nullable(),
  branch_id: UUID.nullable(),
  can_view_all_data: z.boolean(),
  can_edit_team_members: z.boolean(),
  can_override_permissions: z.boolean(),
  can_see_earnings: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

export type UpsertUserScopeInput = z.infer<typeof scopeSchema>;

const SCOPE_COLS = "scope_type, team_id, branch_id, can_view_all_data, can_edit_team_members, can_override_permissions, can_see_earnings";

export async function upsertUserScope(raw: UpsertUserScopeInput): Promise<AccessControlResult> {
  const ctx = await requireScopeEditor();
  if ("error" in ctx) return { error: ctx.error };
  const parsed = scopeSchema.safeParse(raw);
  if (!parsed.success) return { error: "Kapsam girdisi geçersiz." };
  const input = parsed.data;
  if (!ASSIGNABLE_SCOPES.includes(input.scope_type)) return { error: "Bu kapsam türü atanamaz." };

  const t = await loadTarget(ctx, input.userId);
  if ("error" in t) return { error: t.error };
  const { target } = t;

  const next: ScopeInput = normalizeScopeInput({
    scope_type: input.scope_type,
    team_id: input.team_id,
    branch_id: input.branch_id,
    can_view_all_data: input.can_view_all_data,
    can_edit_team_members: input.can_edit_team_members,
    can_override_permissions: input.can_override_permissions,
    can_see_earnings: input.can_see_earnings,
  });
  const rule = canChangeScope({ userId: ctx.userId, role: ctx.role }, { userId: target.id, role: target.role }, next);
  if (!rule.ok) return { error: rule.reason };

  // Takım/şube aynı ofiste mi? (FK tek başına başka ofis kimliğini engellemez)
  if (next.team_id) {
    const { data } = await ctx.supabase.from("teams").select("id").eq("id", next.team_id).eq("tenant_id", ctx.tenantId).eq("is_active", true).maybeSingle();
    if (!data) return { error: "Seçilen takım bu ofise ait aktif bir takım değil." };
  }
  if (next.branch_id) {
    const { data } = await ctx.supabase.from("branches").select("id").eq("id", next.branch_id).eq("tenant_id", ctx.tenantId).eq("is_active", true).maybeSingle();
    if (!data) return { error: "Seçilen şube bu ofise ait aktif bir şube değil." };
  }

  const before = await ctx.supabase.from("user_scopes").select(SCOPE_COLS).eq("tenant_id", ctx.tenantId).eq("user_id", target.id).maybeSingle();
  if (before.error) return { error: schemaOrGeneric(before.error, "Mevcut kapsam okunamadı.") };
  const prev = (before.data as Record<string, unknown> | null) ?? null;
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return { ok: true }; // değişiklik yok

  const nowIso = new Date(now()).toISOString();
  const { error } = await ctx.supabase.from("user_scopes").upsert(
    {
      tenant_id: ctx.tenantId,
      user_id: target.id,
      ...next,
      created_by: ctx.userId,
      updated_by: ctx.userId,
      updated_at: nowIso,
    },
    { onConflict: "tenant_id,user_id" },
  );
  if (error) return { error: schemaOrGeneric(error, "Kapsam kaydedilemedi.") };

  const audit = await recordAccessAudit(ctx.supabase, {
    tenantId: ctx.tenantId,
    subjectUserId: target.id,
    actorId: ctx.userId,
    changeType: prev ? "scope_updated" : "scope_created",
    before: prev,
    after: next,
    reason: input.reason ?? null,
    meta: { target_role: target.role, scope_label: SCOPE_LABELS[next.scope_type] },
  });
  if (!audit.ok) {
    // Kayıtsız yetki değişikliği olmaz: önceki duruma dön.
    if (prev) await ctx.supabase.from("user_scopes").update({ ...prev, updated_by: ctx.userId, updated_at: nowIso }).eq("tenant_id", ctx.tenantId).eq("user_id", target.id);
    else await ctx.supabase.from("user_scopes").delete().eq("tenant_id", ctx.tenantId).eq("user_id", target.id);
    return { error: "Denetim kaydı yazılamadığı için kapsam değişikliği geri alındı. Migration 20261006000104 uygulandı mı?" };
  }
  revalidate();
  return { ok: true };
}

/** Kapsam satırını siler → kullanıcı rol varsayılanına döner. */
export async function resetUserScope(userId: string, reason?: string): Promise<AccessControlResult> {
  const ctx = await requireScopeEditor();
  if ("error" in ctx) return { error: ctx.error };
  if (!UUID.safeParse(userId).success) return { error: "Üye kimliği geçersiz." };
  const t = await loadTarget(ctx, userId);
  if ("error" in t) return { error: t.error };
  const { target } = t;
  // Silme de bir kapsam değişikliğidir: aynı kural (kendine/ofis sahibine dokunma) rol varsayılanıyla sınanır.
  const def = defaultUserScopeForRole(target.role as AppRole, { userId: target.id, tenantId: ctx.tenantId });
  const rule = canChangeScope(
    { userId: ctx.userId, role: ctx.role },
    { userId: target.id, role: target.role },
    { scope_type: def.scope_type, team_id: null, branch_id: null, can_view_all_data: def.can_view_all_data, can_edit_team_members: def.can_edit_team_members, can_override_permissions: def.can_override_permissions, can_see_earnings: def.can_see_earnings },
  );
  if (!rule.ok) return { error: rule.reason };

  const before = await ctx.supabase.from("user_scopes").select(SCOPE_COLS).eq("tenant_id", ctx.tenantId).eq("user_id", target.id).maybeSingle();
  if (before.error) return { error: schemaOrGeneric(before.error, "Mevcut kapsam okunamadı.") };
  if (!before.data) return { ok: true };
  const prev = before.data as Record<string, unknown>;

  const { error } = await ctx.supabase.from("user_scopes").delete().eq("tenant_id", ctx.tenantId).eq("user_id", target.id);
  if (error) return { error: actionErrorMessage(error, "Kapsam kaldırılamadı.") };
  const audit = await recordAccessAudit(ctx.supabase, {
    tenantId: ctx.tenantId,
    subjectUserId: target.id,
    actorId: ctx.userId,
    changeType: "scope_deleted",
    before: prev,
    after: null,
    reason: reason?.trim() || "Rol varsayılanına dönüldü",
    meta: { target_role: target.role },
  });
  if (!audit.ok) {
    await ctx.supabase.from("user_scopes").insert({ tenant_id: ctx.tenantId, user_id: target.id, ...prev, created_by: ctx.userId, updated_by: ctx.userId });
    return { error: "Denetim kaydı yazılamadığı için işlem geri alındı." };
  }
  revalidate();
  return { ok: true };
}

// ───────────────────────── İstisnalar (scope_overrides) ─────────────────────────

const overrideSchema = z.object({
  userId: UUID,
  resource_type: z.enum(["demand", "property", "deal", "commission"]),
  resource_id: UUID,
  allowed: z.boolean(),
  reason: z.string().trim().min(1).max(300),
  /** ISO; null = süresiz (yalnız yasaklamada). */
  expires_at: z.string().nullable(),
});

export type CreateScopeOverrideInput = z.infer<typeof overrideSchema>;

export async function createScopeOverride(raw: CreateScopeOverrideInput): Promise<AccessControlResult> {
  const ctx = await requireScopeEditor();
  if ("error" in ctx) return { error: ctx.error };
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) return { error: "İstisna girdisi geçersiz (gerekçe ve kaynak zorunlu)." };
  const input = parsed.data;
  const t = await loadTarget(ctx, input.userId);
  if ("error" in t) return { error: t.error };
  const { target } = t;

  const rule = canCreateOverride({ userId: ctx.userId, role: ctx.role }, { userId: target.id, role: target.role }, input, now());
  if (!rule.ok) return { error: rule.reason };

  // Kaynak bu ofiste mi? (RLS tenant'ı kısıtlar; yine de başka ofis kimliği yazılmasın)
  const exists = await resourceExists(ctx, input.resource_type, input.resource_id);
  if (!exists) return { error: "Seçilen kayıt bu ofiste bulunamadı." };

  const before = await ctx.supabase
    .from("scope_overrides")
    .select("id, allowed, reason, expires_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", target.id)
    .eq("resource_type", input.resource_type)
    .eq("resource_id", input.resource_id)
    .maybeSingle();
  if (before.error) return { error: schemaOrGeneric(before.error, "Mevcut istisna okunamadı.") };
  const prev = (before.data as Record<string, unknown> | null) ?? null;

  const row = { allowed: input.allowed, reason: input.reason, expires_at: input.expires_at };
  const { data: saved, error } = await ctx.supabase
    .from("scope_overrides")
    .upsert(
      { tenant_id: ctx.tenantId, user_id: target.id, resource_type: input.resource_type, resource_id: input.resource_id, ...row, created_by: ctx.userId, created_at: new Date(now()).toISOString() },
      { onConflict: "tenant_id,user_id,resource_type,resource_id" },
    )
    .select("id")
    .maybeSingle();
  if (error) return { error: schemaOrGeneric(error, "İstisna kaydedilemedi.") };

  const audit = await recordAccessAudit(ctx.supabase, {
    tenantId: ctx.tenantId,
    subjectUserId: target.id,
    actorId: ctx.userId,
    changeType: prev ? "override_updated" : "override_created",
    before: prev ? { allowed: prev.allowed, reason: prev.reason, expires_at: prev.expires_at } : null,
    after: row,
    reason: input.reason,
    meta: { resource_type: input.resource_type, resource_id: input.resource_id, resource_label: OVERRIDE_RESOURCE_LABELS[input.resource_type] },
  });
  if (!audit.ok) {
    if (prev) {
      await ctx.supabase.from("scope_overrides").update({ allowed: prev.allowed, reason: prev.reason, expires_at: prev.expires_at }).eq("id", String(prev.id)).eq("tenant_id", ctx.tenantId);
    } else if (saved?.id) {
      await ctx.supabase.from("scope_overrides").delete().eq("id", saved.id).eq("tenant_id", ctx.tenantId);
    }
    return { error: "Denetim kaydı yazılamadığı için istisna geri alındı. Migration 20261006000104 uygulandı mı?" };
  }
  revalidate();
  return { ok: true };
}

/** İptal: süresi şimdiye çekilir (satır soluk görünür, geçmiş korunur). */
export async function cancelScopeOverride(id: string, reason?: string): Promise<AccessControlResult> {
  const ctx = await requireScopeEditor();
  if ("error" in ctx) return { error: ctx.error };
  if (!UUID.safeParse(id).success) return { error: "İstisna kimliği geçersiz." };
  const before = await ctx.supabase
    .from("scope_overrides")
    .select("id, user_id, resource_type, resource_id, allowed, reason, expires_at")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (before.error) return { error: schemaOrGeneric(before.error, "İstisna okunamadı.") };
  if (!before.data) return { error: "İstisna bulunamadı." };
  const prev = before.data as { id: string; user_id: string; resource_type: string; resource_id: string; allowed: boolean; reason: string | null; expires_at: string | null };
  if (prev.user_id === ctx.userId) return { error: "Kendi istisnanızı değiştiremezsiniz." };
  const nowIso = new Date(now()).toISOString();
  if (prev.expires_at && new Date(prev.expires_at).getTime() <= now()) return { ok: true }; // zaten süresi dolmuş

  const { error } = await ctx.supabase.from("scope_overrides").update({ expires_at: nowIso }).eq("id", prev.id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: actionErrorMessage(error, "İstisna iptal edilemedi.") };
  const audit = await recordAccessAudit(ctx.supabase, {
    tenantId: ctx.tenantId,
    subjectUserId: prev.user_id,
    actorId: ctx.userId,
    changeType: "override_deleted",
    before: { allowed: prev.allowed, reason: prev.reason, expires_at: prev.expires_at },
    after: { allowed: prev.allowed, reason: prev.reason, expires_at: nowIso },
    reason: reason?.trim() || "İptal edildi",
    meta: { resource_type: prev.resource_type, resource_id: prev.resource_id },
  });
  if (!audit.ok) {
    await ctx.supabase.from("scope_overrides").update({ expires_at: prev.expires_at }).eq("id", prev.id).eq("tenant_id", ctx.tenantId);
    return { error: "Denetim kaydı yazılamadığı için iptal geri alındı." };
  }
  revalidate();
  return { ok: true };
}

async function resourceExists(ctx: Editor, type: ScopeOverride["resource_type"], id: string): Promise<boolean> {
  const table = type === "demand" ? "customer_demands" : type === "property" || type === "portfolio" ? "properties" : type === "deal" ? "deals" : "commissions";
  const { data, error } = await ctx.supabase.from(table).select("id").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  return !error && Boolean(data);
}

// ───────────────────────── Kaynak arama (istisna seçici) ─────────────────────────

export type ResourceOption = { value: string; label: string; hint?: string };

/** İstisna kaynağı seçici: türüne göre ad/kod ile arar (en çok 20). Yalnız okuma izni ister; RLS ofisi kısıtlar. */
export async function searchScopeResources(resourceType: string, query: string): Promise<ResourceOption[]> {
  const gate = await requirePermission("settings", "view");
  if (!gate.ok) return [];
  const type = OVERRIDE_RESOURCE_TYPES.find((t) => t === resourceType);
  const term = String(query ?? "").trim().slice(0, 60);
  if (!type || term.length < 2) return [];
  const supabase = await createClient();
  const like = safeLike(term);
  try {
    if (type === "property") {
      const { data } = await supabase.from("properties").select("id, property_code, title").eq("tenant_id", gate.tenantId).is("deleted_at", null).or(orIlike(["property_code", "title"], term)).order("created_at", { ascending: false }).limit(20);
      return (data ?? []).map((p) => ({ value: p.id as string, label: (p.title as string | null) || (p.property_code as string), hint: p.property_code as string }));
    }
    // Müşteri adıyla: talep / anlaşma / komisyon müşteri üzerinden bulunur.
    const { data: customers } = await supabase.from("customers").select("id, full_name").eq("tenant_id", gate.tenantId).is("deleted_at", null).ilike("full_name", like).limit(30);
    const ids = (customers ?? []).map((c) => c.id as string);
    if (ids.length === 0) return [];
    const nameOf = new Map((customers ?? []).map((c) => [c.id as string, c.full_name as string]));
    if (type === "demand") {
      const { data } = await supabase.from("customer_demands").select("id, customer_id, transaction_type, property_type, status").eq("tenant_id", gate.tenantId).in("customer_id", ids).order("created_at", { ascending: false }).limit(20);
      return (data ?? []).map((d) => ({ value: d.id as string, label: nameOf.get(d.customer_id as string) ?? "Talep", hint: `${d.transaction_type}${d.property_type ? ` · ${d.property_type}` : ""} · ${d.status}` }));
    }
    const { data: deals } = await supabase.from("deals").select("id, customer_id, stage, deal_value").eq("tenant_id", gate.tenantId).in("customer_id", ids).order("updated_at", { ascending: false }).limit(20);
    if (type === "deal") {
      return (deals ?? []).map((d) => ({ value: d.id as string, label: nameOf.get(d.customer_id as string) ?? "Anlaşma", hint: `Aşama: ${d.stage}` }));
    }
    const dealIds = (deals ?? []).map((d) => d.id as string);
    if (dealIds.length === 0) return [];
    const dealCustomer = new Map((deals ?? []).map((d) => [d.id as string, d.customer_id as string]));
    const { data: commissions } = await supabase.from("commissions").select("id, deal_id, status, gross_amount").eq("tenant_id", gate.tenantId).in("deal_id", dealIds).order("created_at", { ascending: false }).limit(20);
    return (commissions ?? []).map((c) => ({ value: c.id as string, label: nameOf.get(dealCustomer.get(c.deal_id as string) ?? "") ?? "Komisyon", hint: `Durum: ${c.status}` }));
  } catch (e) {
    console.error("searchScopeResources", e);
    return [];
  }
}

// ───────────────────────── Denetim günlüğü ─────────────────────────

export type AccessAuditRow = {
  id: string;
  user_id: string;
  change_type: string;
  details: Record<string, unknown> | null;
  reason: string | null;
  created_by: string;
  created_at: string;
};

export type ListAccessAuditResult = { rows: AccessAuditRow[]; total: number; schemaMissing: boolean; error?: string };

/** Filtreli, sayfalı denetim günlüğü (owner/gm RLS). Sayfa ve CSV aynı süzgeci (`applyAccessAuditFilters`) kullanır. */
export async function listAccessAudit(filters: Partial<AccessAuditFilters>, page = 1, pageSize = 50): Promise<ListAccessAuditResult> {
  const gate = await requirePermission("settings", "view");
  if (!gate.ok) return { rows: [], total: 0, schemaMissing: false, error: gate.error };
  const f = normalizeAccessAuditFilters(filters);
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const supabase = await createClient();
  const { data, count, error } = await applyAccessAuditFilters(
    supabase.from("access_audit_log").select("id, user_id, change_type, details, reason, created_by, created_at", { count: "exact" }).eq("tenant_id", gate.tenantId),
    f,
  )
    .order("created_at", { ascending: false })
    .range(offset, offset + size - 1);
  if (error) {
    const missing = MISSING_SCHEMA.has(String(error.code));
    if (!missing) console.error("listAccessAudit", error);
    return { rows: [], total: 0, schemaMissing: missing, error: missing ? undefined : actionErrorMessage(error, "Denetim günlüğü okunamadı.") };
  }
  return { rows: (data ?? []) as AccessAuditRow[], total: count ?? 0, schemaMissing: false };
}
