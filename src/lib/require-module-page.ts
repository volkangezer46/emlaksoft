import { redirect } from "next/navigation";
import { lockedGate } from "@/lib/billing/page-gates";
import { getRequestProfile, getTenantGateContext } from "@/lib/cache/request";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { featureForHref, moduleClosedHref } from "@/lib/modules/registry";
import { isModuleEnabled } from "@/lib/modules/state";
import { type AppModule, DEFAULT_MATRIX } from "@/lib/permissions";
import {
  effectiveCanAccessModule,
  getEffectivePermissions,
  immutableReadonlyPermissions,
  mergeEffectivePermissions,
  type EffectivePermissions,
} from "@/lib/permissions-effective";
import { loadShellBootstrap } from "@/lib/app-shell/bootstrap";

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

  // Kabuk RPC'si (layout ile AYNI istek-içi cache): varsa profil + izin satırları + paket bağlamı tek turdan
  // gelir ve bu kapı ek sorgu atmaz. Yoksa (migration uygulanmadı / impersonation) eski sorgular aynen çalışır.
  const boot = impersonating ? null : await loadShellBootstrap();
  const bootOwn = boot && boot.profile.id === user.id ? boot : null;
  const profile = bootOwn ? { role: bootOwn.profile.role, tenant_id: bootOwn.profile.tenantId } : await getRequestProfile(user.id);
  // B12: fail-closed — profil/rol okunamıyorsa "advisor" yetkisi uydurulmaz.
  const role = resolvePageRole(impersonating, profile);
  if (!role) redirect("/giris");
  const claimedTenantId = typeof user.app_metadata?.tenant_id === "string"
    ? user.app_metadata.tenant_id.trim() || null
    : null;
  const tenantId = impersonating ? claimedTenantId : (profile?.tenant_id ?? claimedTenantId);

  const perms = impersonating
    ? immutableReadonlyPermissions()
    : bootOwn && bootOwn.profile.tenantId === tenantId
      ? mergeEffectivePermissions(role, bootOwn.roleOverrides, bootOwn.userOverrides)
      : await getEffectivePermissions(tenantId, role, user.id);
  if (!effectiveCanAccessModule(perms, mod)) {
    redirect("/app?yetki=yok");
  }
  if (href && tenantId) {
    const gateCtx =
      bootOwn && bootOwn.profile.tenantId === tenantId && bootOwn.office
        ? { plan: bootOwn.office.plan ?? null, trial: bootOwn.office.status === "trial", tenantCreatedAt: bootOwn.office.created_at ?? null }
        : await getTenantGateContext(tenantId);
    const gate = lockedGate(href, gateCtx);
    if (gate) redirect(`/app/paket?ozellik=${encodeURIComponent(gate.href)}`);
  }
  // Sıra: oturum -> yetki -> paket -> modül. Ofisin kapattığı modül 404 değil, açıklayıcı sayfa gösterir.
  if (href && tenantId) {
    const closedKey = featureForHref(href);
    if (closedKey && !(await isModuleEnabled(tenantId, closedKey))) redirect(moduleClosedHref(closedKey));
  }
  return { userId: user.id, role, tenantId, perms };
}
