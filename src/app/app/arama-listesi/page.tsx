
import { PageHeader } from "@/components/ui/page-header";
import { ScopeBadge } from "@/components/app/scope-badge";
import { requireModulePage } from "@/lib/require-module-page";
import { getListScope } from "@/lib/access-control";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { loadCallList } from "./data";
import { CallQueue } from "./call-queue";

export const metadata = { title: "Arama listesi" };

/**
 * Arama listesi (hafif power dialer): bugün aranması gereken müşteriler sırayla — ara / WhatsApp, ardından
 * görüşme sonucu alttaki şeritten (CallOutcomeStrip) tek dokunuşla kaydedilir ve sıradaki müşteriye geçilir.
 * Kapsam: yönetim rolleri ofis kapsamını, diğerleri yalnız kendine atanan müşterileri görür (ofis kapsam kuralı daraltabilir).
 */
export default async function CallListPage() {
  const { tenantId, userId, role } = await requireModulePage("customers", "/app/arama-listesi");
  const listScope = await getListScope({ userId, tenantId, role, mineOnly: !hasOfficeWideDataScope(role) });
  const rows = await loadCallList({ tenantId, userId, role, scopeFilter: listScope.filter });

  return (
    <div className="space-y-4">
      <PageHeader
        variant="card"
        art="gorev"
        eyebrow="Günün aramaları"
        title="Arama listesi"
        description="Bugün aranacak müşteriler öncelik sırasıyla: önce arama görevleri, sonra kaybedilme riski ve sıcak müşteriler. Ara'ya basın, görüşme bitince sonucu seçin."
        meta={<ScopeBadge text={listScope.badge} />}
        freshness
      />
      <CallQueue rows={rows} />
    </div>
  );
}
