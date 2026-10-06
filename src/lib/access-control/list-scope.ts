/**
 * Liste sayfaları ve dışa aktarma için ÇÖZÜMLENMİŞ kapsam (sunucu).
 *
 *  getListScope({ userId, tenantId, role, mineOnly? })
 *    → { filter, enforced, scope, badge }
 *
 * - Ofis bayrağı `office.access.scope_enforcement` KAPALIYSA (varsayılan) `filter` yalnız eski kuraldan
 *   gelir (`mineOnly` → self, değilse none): bugünkü davranış birebir korunur.
 * - AÇIKSA kullanıcı kapsamı uygulanır; eski kural daha darsa o kazanır (kapsam yalnız daraltır).
 * - team/branch üyeleri `profiles` üzerinden (RLS: kendi ofisi) okunur; şema yoksa fail-closed self.
 * Çağıran sayfa `applyScopeFilter(query, filter, { ownerColumn })` ile sorguya bağlar; rozet `badge` ile çizilir.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/settings/read";
import { SCOPE_ENFORCEMENT_KEY } from "@/lib/settings/registry/tenant";
import type { AppRole } from "@/lib/permissions";
import { getUserScope } from "./scope-cache";
import { resolveScopeFilter, scopeBadgeText, tightenScopeFilter, type ScopeFilter } from "./query-scope";
import type { UserScope } from "./types";

export type ListScope = {
  filter: ScopeFilter;
  /** Ofis bayrağı açık ve kapsam gerçekten uygulanıyor. */
  enforced: boolean;
  scope: UserScope;
  /** "Kapsam: Takım (Satış A)" — daraltma yoksa null. */
  badge: string | null;
};

const SCOPE_MEMBER_QUERY_CAP = 500;

const loadMembers = cache(async function loadMembers(tenantId: string, column: "team_id" | "branch_id", value: string): Promise<string[] | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("id").eq("tenant_id", tenantId).eq(column, value).eq("is_active", true).limit(SCOPE_MEMBER_QUERY_CAP);
    if (error) return null; // sütun yok (takım migration'ı uygulanmadı) → fail-closed self
    return (data ?? []).map((r) => String(r.id));
  } catch {
    return null;
  }
});

const loadContextName = cache(async function loadContextName(table: "teams" | "branches", id: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from(table).select("name").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return (data as { name?: string | null }).name ?? null;
  } catch {
    return null;
  }
});

const isEnforced = cache(async function isEnforced(tenantId: string): Promise<boolean> {
  try {
    return Boolean(await getSetting<boolean>(SCOPE_ENFORCEMENT_KEY, { tenantId }));
  } catch {
    return false;
  }
});

export async function getListScope(input: {
  userId: string;
  tenantId: string | null | undefined;
  role: string;
  /** Mevcut rol kuralı "yalnız kendi kayıtları" diyorsa true (örn. !hasOfficeWideDataScope(role)). */
  mineOnly?: boolean;
}): Promise<ListScope> {
  const legacy: ScopeFilter = input.mineOnly ? { kind: "self", userId: input.userId } : { kind: "none" };
  const role = input.role as AppRole;
  const tenantId = input.tenantId ?? "";
  const scope = tenantId ? await getUserScope(input.userId, tenantId, role) : null;
  const fallbackScope: UserScope = scope ?? {
    user_id: input.userId,
    tenant_id: tenantId,
    scope_type: "office",
    team_id: null,
    branch_id: null,
    can_view_all_data: true,
    can_edit_team_members: false,
    can_override_permissions: false,
    can_see_earnings: false,
  };

  if (!tenantId || !scope || !(await isEnforced(tenantId))) {
    return { filter: legacy, enforced: false, scope: fallbackScope, badge: null };
  }

  let members: string[] | null = null;
  let teamName: string | null = null;
  let branchName: string | null = null;
  if (scope.scope_type === "team" && scope.team_id) {
    [members, teamName] = await Promise.all([loadMembers(tenantId, "team_id", scope.team_id), loadContextName("teams", scope.team_id)]);
  } else if (scope.scope_type === "branch" && scope.branch_id) {
    [members, branchName] = await Promise.all([loadMembers(tenantId, "branch_id", scope.branch_id), loadContextName("branches", scope.branch_id)]);
  }

  const filter = tightenScopeFilter(resolveScopeFilter(scope, members), { mineOnly: Boolean(input.mineOnly), userId: input.userId });
  return {
    filter,
    enforced: true,
    scope,
    badge: scopeBadgeText(scope.scope_type, filter, { teamName, branchName }),
  };
}
