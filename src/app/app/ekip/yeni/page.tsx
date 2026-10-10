import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { getPlanUsage } from "@/lib/nav-badges";
import { getExtraSeats } from "@/lib/billing/seat-purchase";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import type { AppRole } from "@/lib/permissions";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { getProvinceOptions } from "@/lib/geo/reader";
import { loadSpecialtyOptions, probeAdvisorSpecialtySchema } from "@/lib/advisor/advisor-store";
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

  const baseSeats = usage.find((u) => u.key === "seats") ?? null;
  // Satın alınmış ek kullanıcı varsa etkin limit = plan limiti + ek (sütun yoksa 0).
  const extraSeats = baseSeats ? await getExtraSeats(supabase, ctx.tenantId) : 0;
  const seats = baseSeats ? { ...baseSeats, limit: baseSeats.limit + extraSeats } : null;
  const extras = await loadExtras(supabase, ctx.role);

  return (
    <AdvisorForm
      userId={ctx.userId}
      officeName={tenant?.name ?? "Ofisiniz"}
      branches={(branches ?? []).map((b) => ({ id: b.id as string, name: b.name as string }))}
      rolePermissions={rolePermissions}
      seats={seats ? { used: seats.used, limit: seats.limit } : null}
      extras={extras}
    />
  );
}

/**
 * "Uzmanlık ve bölge" adımı yalnız ofis sahibi / genel müdür içindir (RLS yazmayı böyle sınırlar) ve ilgili tablolar
 * uygulanmışsa açılır; aksi halde adım gizlenir ve nedeni bir not olarak gösterilir. Kimlik/belge/hedef alanları
 * danışman detayında sonra doldurulur.
 */
async function loadExtras(supabase: Awaited<ReturnType<typeof createClient>>, role: string): Promise<AdvisorExtras> {
  const empty: AdvisorExtras = {
    specialty: false,
    provinces: [],
    options: { propertyTypes: [], segments: [] },
    notice: null,
  };
  if (role !== "owner" && role !== "gm") {
    return { ...empty, notice: "Uzmanlık ve bölge alanlarını yalnız ofis sahibi veya genel müdür doldurur; danışman detayından sonradan eklenebilir." };
  }
  const specialty = await probeAdvisorSpecialtySchema(supabase);
  if (!specialty) {
    return { ...empty, notice: "Uzmanlık ve bölge alanları bu ortamda henüz etkin değil." };
  }
  const [provinces, options] = await Promise.all([getProvinceOptions(), loadSpecialtyOptions()]);
  return { specialty, provinces, options, notice: null };
}
