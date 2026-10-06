/**
 * Rol değişince kapsam varsayılanını yeniden yazar (ekip akışından çağrılır; admin istemci PARAMETRE olarak gelir,
 * kendi service_role istemcisini yaratmaz). Tablo yoksa (migration uygulanmadı) sessizce atlar.
 *
 * Neden: owner "advisor → team_lead" yaptığında eski "user" satırı kalırsa yeni lider takımını göremez;
 * tersine "gm → advisor" yapılınca eski "office" satırı kalırsa danışman tüm ofisi görmeye devam eder.
 * Rol değişimi kapsamı HER ZAMAN rol varsayılanına çeker; özel kapsam gerekiyorsa yönetici yetkilendirme
 * ekranından yeniden tanımlar (denetim günlüğü bunu `scope_updated` olarak gösterir).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/permissions";
import { recordAccessAudit } from "./audit";
import { defaultUserScopeForRole } from "./scope-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST204"]);

export async function syncScopeForRoleChange(
  admin: AnyClient,
  input: { tenantId: string; userId: string; newRole: AppRole; oldRole: string; actorId: string; teamId?: string | null; branchId?: string | null },
): Promise<void> {
  const next = defaultUserScopeForRole(input.newRole, {
    userId: input.userId,
    tenantId: input.tenantId,
    teamId: input.teamId ?? null,
    branchId: input.branchId ?? null,
  });
  try {
    const existing = await admin
      .from("user_scopes")
      .select("scope_type, team_id, branch_id, can_view_all_data, can_edit_team_members, can_override_permissions, can_see_earnings")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (existing.error) {
      if (!MISSING_TABLE.has(String(existing.error.code))) console.error("syncScopeForRoleChange read", existing.error);
      return;
    }
    const row = {
      scope_type: next.scope_type,
      team_id: next.team_id,
      branch_id: next.branch_id,
      can_view_all_data: next.can_view_all_data,
      can_edit_team_members: next.can_edit_team_members,
      can_override_permissions: next.can_override_permissions,
      can_see_earnings: next.can_see_earnings,
    };
    const before = (existing.data as Record<string, unknown> | null) ?? null;
    if (before && JSON.stringify(before) === JSON.stringify(row)) return; // değişiklik yok: gürültü yazma
    const { error } = await admin.from("user_scopes").upsert(
      { tenant_id: input.tenantId, user_id: input.userId, ...row, updated_by: input.actorId, updated_at: new Date().toISOString(), created_by: input.actorId },
      { onConflict: "tenant_id,user_id" },
    );
    if (error) {
      console.error("syncScopeForRoleChange upsert", error);
      return;
    }
    await recordAccessAudit(admin, {
      tenantId: input.tenantId,
      subjectUserId: input.userId,
      actorId: input.actorId,
      changeType: before ? "scope_updated" : "scope_created",
      before,
      after: row,
      reason: `Rol değişti: ${input.oldRole} → ${input.newRole} (varsayılan kapsam)`,
      meta: { source: "role_change" },
    });
  } catch (e) {
    console.error("syncScopeForRoleChange", e);
  }
}
