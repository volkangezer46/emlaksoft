import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { lockedGate } from "@/lib/billing/page-gates";
import { getTenantGateContext } from "@/lib/cache/request";
import { AdvisorDetailView } from "./advisor-view";

/**
 * Danışman 360. Kapı iki katmanlıdır: KENDİ profili her rolde ve her pakette açıktır (Performansım ile aynı gövde;
 * Ekip modülü olmayan rol `/app/performansim`'e gider). BAŞKASININ profili için Ekip modülü + ofis geneli veri
 * kapsamı (sahip, GM, şube müdürü) + Ekip yönetimi paket kapısı (Ofis) gerekir.
 */
export default async function TeamMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireModulePage("dashboard");
  const { id } = await params;
  const isSelf = id === auth.userId;
  const hasTeam = effectiveCanAccessModule(auth.perms, "team");

  if (isSelf && !hasTeam) redirect("/app/performansim");
  if (!isSelf) {
    // Kapsam: ofis geneli rol herkesin profilini, diğerleri yalnız kendi profilini görür.
    if (!hasTeam || !hasOfficeWideDataScope(auth.role)) redirect("/app/performansim");
    if (auth.tenantId) {
      const gate = lockedGate("/app/ekip", await getTenantGateContext(auth.tenantId));
      if (gate) redirect(`/app/paket?ozellik=${encodeURIComponent(gate.href)}`);
    }
  }

  const sp = (await searchParams) ?? {};
  return (
    <AdvisorDetailView
      memberId={id}
      basePath={`/app/ekip/${id}`}
      backHref={{ href: "/app/ekip", label: "Ekip" }}
      searchParams={sp}
      auth={auth}
    />
  );
}
