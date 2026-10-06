/**
 * Kullanıcı kapsamı önbellek (server-side caching).
 * İstek başına bir kez hesaplanır.
 *
 * Kaynak sırası: `user_scopes` satırı (ofis yöneticisi yazmış) → yoksa rol varsayılanı
 * (`defaultUserScopeForRole`) + profilden takım/şube bağlamı. Tablo henüz yoksa (migration
 * uygulanmadı) sessizce rol varsayılanına düşer.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { UserScope } from "./types";
import { defaultUserScopeForRole, SCOPE_RANK } from "./scope-rules";
import { minimumScopeForRole } from "./admin-rules";
import type { AppRole } from "@/lib/permissions";

type ScopeRow = {
  scope_type: UserScope["scope_type"];
  team_id: string | null;
  branch_id: string | null;
  can_view_all_data: boolean;
  can_edit_team_members: boolean;
  can_override_permissions: boolean;
  can_see_earnings: boolean;
};

/** Takım/şube bağlamı profilden (team_id sütunu yoksa yalnız branch_id). */
async function loadProfileContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  tenantId: string,
): Promise<{ teamId: string | null; branchId: string | null }> {
  const full = await supabase.from("profiles").select("team_id, branch_id").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (!full.error && full.data) {
    const row = full.data as { team_id?: string | null; branch_id?: string | null };
    return { teamId: row.team_id ?? null, branchId: row.branch_id ?? null };
  }
  // team_id sütunu henüz yok (takım migration'ı uygulanmadı): yalnız şube.
  const lite = await supabase.from("profiles").select("branch_id").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  return { teamId: null, branchId: (lite.data as { branch_id?: string | null } | null)?.branch_id ?? null };
}

/**
 * Kullanıcının kapsam türünü, takım/şube bağlamını ve yetkilendirmesini yükle.
 * Cache() ile istek başına bir kez çalışır.
 */
export const getUserScope = cache(async function getUserScope(
  userId: string,
  tenantId: string,
  role: AppRole,
): Promise<UserScope> {
  let ctx: { teamId: string | null; branchId: string | null } = { teamId: null, branchId: null };
  let row: ScopeRow | null = null;
  try {
    const supabase = await createClient();
    const [profileCtx, scopeRes] = await Promise.all([
      loadProfileContext(supabase, userId, tenantId),
      supabase
        .from("user_scopes")
        .select("scope_type, team_id, branch_id, can_view_all_data, can_edit_team_members, can_override_permissions, can_see_earnings")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    ctx = profileCtx;
    // Tablo yok / erişim yok: error döner, satır yok sayılır (rol varsayılanı).
    if (!scopeRes.error && scopeRes.data) row = scopeRes.data as ScopeRow;
  } catch (e) {
    console.error(`[getUserScope] kapsam yükleme hatası: ${userId}`, e);
  }

  const fallback = defaultUserScopeForRole(role, { userId, tenantId, teamId: ctx.teamId, branchId: ctx.branchId });
  if (!row) return fallback;

  // Güvenlik tabanı: owner/gm satırı ne derse desin office altına inmez (eski/bozuk satır kilitlemesin).
  const floor = minimumScopeForRole(role);
  const scopeType = SCOPE_RANK[row.scope_type] < SCOPE_RANK[floor] ? floor : row.scope_type;
  return {
    user_id: userId,
    tenant_id: tenantId,
    scope_type: scopeType,
    // Satırda takım/şube yoksa profildeki bağlam kullanılır (takım değişince satır bayatlamasın).
    team_id: row.team_id ?? ctx.teamId,
    branch_id: row.branch_id ?? ctx.branchId,
    can_view_all_data: row.can_view_all_data,
    can_edit_team_members: row.can_edit_team_members,
    can_override_permissions: row.can_override_permissions,
    can_see_earnings: row.can_see_earnings,
  };
});

/**
 * Scope override'ları yükle (geçici istisnalar).
 * Örn: Danışman talep Y'ye erişim hakkı.
 */
export async function loadScopeOverrides(
  userId: string,
  tenantId: string,
): Promise<Map<string, boolean>> {
  const overrides = new Map<string, boolean>();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("scope_overrides")
      .select("resource_type, resource_id, allowed, expires_at")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    if (!error && data) {
      const nowMs = Date.now();
      for (const row of data) {
        // Süresi geçmiş override'ı yok say
        if (row.expires_at && new Date(row.expires_at).getTime() <= nowMs) {
          continue;
        }

        const key = `${row.resource_type}:${row.resource_id}`;
        overrides.set(key, row.allowed);
      }
    }
  } catch (e) {
    console.error(`[loadScopeOverrides] Yükleme hatası: ${userId}`, e);
  }

  return overrides;
}

/**
 * Scope override'ı kontrol et (geçici kural).
 */
export function checkScopeOverride(
  overrides: Map<string, boolean>,
  resourceType: string,
  resourceId?: string,
): boolean | null {
  if (!resourceId) return null;

  const key = `${resourceType}:${resourceId}`;
  return overrides.has(key) ? overrides.get(key) ?? false : null;
}
