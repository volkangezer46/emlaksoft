import { redirect } from "next/navigation";
import { lockedGate } from "@/lib/billing/page-gates";
import { getRequestProfile, getTenantGateContext } from "@/lib/cache/request";
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
/**
 * `href` verilirse paket kilidi de uygulanır (bkz. src/lib/billing/page-gates.ts):
 * kilitliyse kullanıcı özelliğin ne işe yaradığını anlatan yükseltme sayfasına gider.
 */
/** Sayfa kabuğu rolü: impersonation = readonly, profil yoksa null (erişim reddedilir). */
export function resolvePageRole(
  impersonating: boolean,
  profile: { role?: string | null } | null | undefined,
): string | null {
  if (impersonating) return "readonly";
  const role = profile?.role;
  return typeof role === "string" && role.trim() ? role : null;
}

export async function requireModulePage(mod: AppModule, href?: string) {
  const user = await getRequestUser();
  if (!user) redirect("/giris");

  const staff = await getPlatformStaff();
  const impersonating = Boolean(user.app_metadata?.impersonating);
  if (staff && !impersonating) {
    const ownerPerms = DEFAULT_MATRIX.owner as EffectivePermissions;
    return { userId: user.id, role: "owner" as string, tenantId: null as string | null, perms: ownerPerms };
  }

  const profile = await getRequestProfile(user.id);
  // B12: fail-closed — profil/rol okunamıyorsa "advisor" yetkisi uydurulmaz.
  const role = resolvePageRole(impersonating, profile);
  if (!role) redirect("/giris");
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
  if (href && tenantId) {
    const gate = lockedGate(href, await getTenantGateContext(tenantId));
    if (gate) redirect(`/app/paket?ozellik=${encodeURIComponent(gate.href)}`);
  }
  return { userId: user.id, role, tenantId, perms };
}
