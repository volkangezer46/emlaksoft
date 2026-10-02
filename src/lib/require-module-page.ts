import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { type AppModule, DEFAULT_MATRIX } from "@/lib/permissions";
import {
  effectiveCanAccessModule,
  getEffectivePermissions,
  immutableReadonlyPermissions,
  type EffectivePermissions,
} from "@/lib/permissions-effective";

/**
 * Sayfa seviyesi yetki — sidebar URL bypass’ını keser.
 * Platform staff (impersonation hariç) geçer. DB-tabanlı etkin izinleri kullanır
 * (bkz. `getEffectivePermissions`) — sadece varsayılan matris değil, tenant override'ları da uygulanır.
 */
export async function requireModulePage(mod: AppModule) {
  const user = await getRequestUser();
  if (!user) redirect("/giris");

  const staff = await getPlatformStaff();
  const impersonating = Boolean(user.app_metadata?.impersonating);
  if (staff && !impersonating) {
    const ownerPerms = DEFAULT_MATRIX.owner as EffectivePermissions;
    return { userId: user.id, role: "owner" as string, tenantId: null as string | null, perms: ownerPerms };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  const role = impersonating ? "readonly" : (profile?.role ?? "advisor");
  const claimedTenantId = typeof user.app_metadata?.tenant_id === "string"
    ? user.app_metadata.tenant_id.trim() || null
    : null;
  const tenantId = impersonating ? claimedTenantId : (profile?.tenant_id ?? claimedTenantId);

  const perms = impersonating
    ? immutableReadonlyPermissions()
    : await getEffectivePermissions(tenantId, role, user.id);
  if (!effectiveCanAccessModule(perms, mod)) {
    redirect("/app?yetki=yok");
  }
  return { userId: user.id, role, tenantId, perms };
}
