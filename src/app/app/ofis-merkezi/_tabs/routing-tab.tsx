import Link from "@/components/ui/smart-link";
import { ArrowUpRight } from "lucide-react";
import { LeadRoutingForm } from "@/components/app/office-center/lead-routing-form";
import { leadRoutingConfigFrom } from "@/lib/lead-routing/logic";
import { getSettings } from "@/lib/settings/read";
import { LEAD_ROUTING_KEYS } from "@/lib/settings/registry/tenant";
import type { TabContext } from "./context";

/**
 * Talep dağıtımı: vitrin/portal/başvuru formundan gelen yeni talebin hangi danışmana gideceği (yöntem, mesai kuralı) ve ilk
 * dönüş süresi dolunca yeniden atama. TEK MOTOR: uzmanlık/bölge/iş yükü puanı ilan havuzu ve akıllı atama ile aynı koddur;
 * ağırlıklar Tanımlar sekmesindeki akıllı atama ağırlıklarıdır. Her ayar ayar defteri anahtarıdır (geçmiş + geri alma).
 */
export async function RoutingTab({ ctx }: { ctx: TabContext }) {
  const values = await getSettings(Object.values(LEAD_ROUTING_KEYS), { tenantId: ctx.tenantId });
  const config = leadRoutingConfigFrom(values, LEAD_ROUTING_KEYS);
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
        <span>Yeni talepler ve ilk dönüş süresi aşımları tek motorla dağıtılır; ayarlar kapalıyken bugünkü &quot;en az yüklü&quot; davranışı sürer.</span>
        <Link href="/app/raporlar/lead-hizi" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
          Aday hızı raporu <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
        <Link href="/app/ofis-merkezi?sekme=tanimlar" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
          Akıllı atama ağırlıkları <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
        <Link href="/app/ofis-merkezi?sekme=danismanlar" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
          Danışman uzmanlık/bölge kayıtları <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </p>
      <LeadRoutingForm initial={config} canEdit={ctx.canEditSettings} />
    </div>
  );
}
