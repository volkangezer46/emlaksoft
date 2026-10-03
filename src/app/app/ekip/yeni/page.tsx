import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { getPlanUsage } from "@/lib/nav-badges";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import type { AppRole } from "@/lib/permissions";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { AdvisorForm, type RolePermissionSummary } from "./advisor-form";

export const metadata = { title: "Yeni danışman" };

export default async function NewAdvisorPage() {
  const ctx = await requireModulePage("team", "/app/ekip");
  if (!(ctx.perms.team ?? []).includes("create")) redirect("/app/ekip");

  const roles = assignableRolesFor(ctx.role);
  if (roles.length === 0 || !ctx.tenantId) redirect("/app/ekip");

  const supabase = await createClient();
  const { data: tenant } = await supabase.from("tenants").select("name, plan").eq("id", ctx.tenantId).maybeSingle();
  const [{ data: branches }, usage, ...roleMatrices] = await Promise.all([
    supabase.from("branches").select("id, name").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("name"),
    // Plan kullanımı: yan menüyle aynı kaynak (gerçek aktif profil sayısı + paket limiti).
    getPlanUsage(supabase, ctx.tenantId, tenant?.plan),
    // Rolün ETKİN izinleri (varsayılan matris + ofisin rol istisnaları), kullanıcı istisnası olmadan.
    ...roles.map((r) => getEffectivePermissions(ctx.tenantId, r as AppRole)),
  ]);

  const rolePermissions: RolePermissionSummary[] = roles.map((role, i) => ({
    role,
    permissions: Object.fromEntries(
      Object.entries(roleMatrices[i] ?? {}).map(([mod, actions]) => [mod, [...(actions ?? [])]]),
    ),
    seesAllEarnings: canSeeAllEarnings(roleMatrices[i] ?? {}),
  }));

  const seats = usage.find((u) => u.key === "seats") ?? null;

  return (
    <AdvisorForm
      userId={ctx.userId}
      officeName={tenant?.name ?? "Ofisiniz"}
      branches={(branches ?? []).map((b) => ({ id: b.id as string, name: b.name as string }))}
      rolePermissions={rolePermissions}
      seats={seats ? { used: seats.used, limit: seats.limit } : null}
      canSetTargets={(ctx.perms.targets ?? []).includes("create")}
    />
  );
}
