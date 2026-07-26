import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { type AppModule, DEFAULT_MATRIX } from "@/lib/permissions";
import { effectiveCanAccessModule, getEffectivePermissions, type EffectivePermissions } from "@/lib/permissions-effective";

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
  const role = profile?.role ?? "advisor";
  const tenantId = profile?.tenant_id ?? (user.app_metadata?.tenant_id as string | undefined) ?? null;

  const perms = await getEffectivePermissions(tenantId, role, user.id);
  if (!effectiveCanAccessModule(perms, mod)) {
    redirect("/app?yetki=yok");
  }
  return { userId: user.id, role, tenantId, perms };
}
