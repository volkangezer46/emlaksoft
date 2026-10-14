import Link from "@/components/ui/smart-link";
import { ArrowUpRight } from "lucide-react";
import { DefinitionsForm } from "@/components/app/office-center/definitions-form";
import { definitionKeys, definitionsFromSettings } from "@/lib/office-center/definitions";
import { getSettings } from "@/lib/settings/read";
import { NOTIFY_DEFAULTS } from "@/lib/settings/registry/tenant";
import type { TabContext } from "./context";

/**
 * Tanımlar (TEK sekme; eski "Ayarlar" + "Tanımlamalar" aynı ayar anahtarlarına yazıyordu): SLA · komisyon · uyarı
 * eşikleri · akıllı atama ağırlıkları · bildirim kanalları. Hepsi ayar defteri anahtarı; tek tek değer, geçmiş ve geri
 * alma Ayarlar > Tanımlar merkezinde (aynı defter), modül aç/kapa Ayarlar > Modüller'de.
 */
export async function DefinitionsTab({ ctx }: { ctx: TabContext }) {
  const snapshot = definitionsFromSettings(await getSettings(definitionKeys(), { tenantId: ctx.tenantId }));
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
        <span>Her değişiklik doğrulanır, sürümlenir ve geçmişiyle geri alınabilir.</span>
        <Link href="/app/ayarlar/merkez" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
          Tüm ayarlar ve geçmiş <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
        <Link href="/app/ayarlar/moduller" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
          Modüller <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </p>
      <DefinitionsForm initial={snapshot} canEdit={ctx.canEditSettings} notifyLabels={NOTIFY_DEFAULTS.map((n) => ({ id: n.id, label: n.label, description: n.description }))} />
    </div>
  );
}
