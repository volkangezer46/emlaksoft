import { cache } from "react";
import { redirect } from "next/navigation";
import { lockedGate } from "@/lib/billing/page-gates";
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
/** Tenant'ın paket ve deneme bilgisi (istek başına tek sorgu). */
const getTenantGateContext = cache(async (tenantId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("plan, status, created_at").eq("id", tenantId).maybeSingle();
  return {
    plan: data?.plan ?? null,
    trial: data?.status === "trial",
    tenantCreatedAt: data?.created_at ?? null,
  };
});

/**
 * `href` verilirse paket kilidi de uygulanır (bkz. src/lib/billing/page-gates.ts):
 * kilitliyse kullanıcı özelliğin ne işe yaradığını anlatan yükseltme sayfasına gider.
 */
export async function requireModulePage(mod: AppModule, href?: string) {
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
  if (href && tenantId) {
    const gate = lockedGate(href, await getTenantGateContext(tenantId));
    if (gate) redirect(`/app/paket?ozellik=${encodeURIComponent(gate.href)}`);
  }
  return { userId: user.id, role, tenantId, perms };
}
