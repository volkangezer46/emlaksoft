import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { getPlanUsage } from "@/lib/nav-badges";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import type { AppRole } from "@/lib/permissions";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { getProvinceOptions } from "@/lib/geo/reader";
import {
  loadSpecialtyOptions,
  probeAdvisorPrivateSchema,
  probeAdvisorSpecialtySchema,
  probeAdvisorWorkSchema,
} from "@/lib/advisor/advisor-store";
import { piiEnabled } from "@/lib/advisor/pii-crypto";
import { AdvisorForm, type AdvisorExtras, type RolePermissionSummary } from "./advisor-form";

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
  const extras = await loadExtras(supabase, ctx.role);

  return (
    <AdvisorForm
      userId={ctx.userId}
      officeName={tenant?.name ?? "Ofisiniz"}
      branches={(branches ?? []).map((b) => ({ id: b.id as string, name: b.name as string }))}
      rolePermissions={rolePermissions}
      seats={seats ? { used: seats.used, limit: seats.limit } : null}
      canSetTargets={(ctx.perms.targets ?? []).includes("create")}
      extras={extras}
    />
  );
}

/**
 * Kimlik, istihdam, uzmanlık ve bölge sekmeleri yalnız ofis sahibi / genel müdür içindir (RLS yazmayı böyle sınırlar)
 * ve ilgili tablolar uygulanmışsa açılır; aksi halde sekme gizlenir ve nedeni bir not olarak gösterilir.
 */
async function loadExtras(supabase: Awaited<ReturnType<typeof createClient>>, role: string): Promise<AdvisorExtras> {
  const empty: AdvisorExtras = {
    private: false,
    work: false,
    specialty: false,
    piiEnabled: false,
    provinces: [],
    options: { propertyTypes: [], segments: [] },
    notice: null,
  };
  if (role !== "owner" && role !== "gm") {
    return { ...empty, notice: "Kimlik, belge, uzmanlık ve bölge alanlarını yalnız ofis sahibi veya genel müdür doldurur; danışman profilinden sonradan eklenebilir." };
  }
  const [work, priv, specialty] = await Promise.all([
    probeAdvisorWorkSchema(supabase),
    probeAdvisorPrivateSchema(supabase),
    probeAdvisorSpecialtySchema(supabase),
  ]);
  if (!work && !priv && !specialty) {
    return { ...empty, notice: "Kimlik, belge, uzmanlık ve bölge alanları bu ortamda henüz etkin değil." };
  }
  const [provinces, options] = await Promise.all([
    priv || specialty ? getProvinceOptions() : Promise.resolve([]),
    specialty ? loadSpecialtyOptions() : Promise.resolve(empty.options),
  ]);
  return { private: priv, work, specialty, piiEnabled: piiEnabled(), provinces, options, notice: null };
}
