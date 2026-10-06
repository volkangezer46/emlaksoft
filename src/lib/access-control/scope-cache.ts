/**
 * Kullanıcı kapsamı önbellek (server-side caching).
 * Başına bir kez hesaplanır.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AccessScope, UserScope } from "./types";
import { getDefaultScopeForRole } from "./scope-rules";
import type { AppRole } from "@/lib/permissions";

/**
 * Kullanıcının kapsam türünü, takım/şube bağlamını ve yetkilendirmesini yükle.
 * Cache() ile istek başına bir kez çalışır.
 */
export const getUserScope = cache(async function getUserScope(
  userId: string,
  tenantId: string,
  role: AppRole,
): Promise<UserScope> {
  // Varsayılan scope rol tarafından belirlenir
  const scopeType = getDefaultScopeForRole(role);

  let branchId: string | null = null;
  let teamId: string | null = null;

  // Roller spesifik scope'a sahipse (team_lead, branch_manager), konteksti yükle
  if (role === "team_lead" || role === "branch_manager") {
    try {
      const supabase = await createClient();

      // Takım/Şube bilgisini profiles tablosundan yükle
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("team_id, branch_id")
        .eq("id", userId)
        .eq("tenant_id", tenantId)
        .single();

      if (!error && profile) {
        teamId = profile.team_id;
        branchId = profile.branch_id;
      }
    } catch (e) {
      console.error(`[getUserScope] Takım/şube yükleme hatası: ${userId}`, e);
    }
  }

  return {
    user_id: userId,
    scope_type: scopeType,
    tenant_id: tenantId,
    branch_id: branchId,
    team_id: teamId,
    can_view_all_data: ["owner", "gm", "accounting"].includes(role),
    can_edit_team_members: ["owner", "gm", "branch_manager", "team_lead"].includes(role),
    can_override_permissions: ["owner", "gm"].includes(role),
    can_see_earnings: ["owner", "gm", "accounting"].includes(role),
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
      for (const row of data) {
        // Süresi geçmiş override'ı yok say
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
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
