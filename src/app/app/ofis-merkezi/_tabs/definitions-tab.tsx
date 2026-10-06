import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DefinitionsForm } from "@/components/app/office-center/definitions-form";
import { definitionKeys, definitionsFromSettings } from "@/lib/office-center/definitions";
import { tabHref } from "@/lib/office-center/logic";
import { getSettings } from "@/lib/settings/read";
import { NOTIFY_DEFAULTS } from "@/lib/settings/registry/tenant";
import type { TabContext } from "./context";

/** Tanımlamalar: SLA · komisyon · uyarı eşikleri · akıllı atama ağırlıkları · bildirim kanalları (hepsi ayar defteri anahtarı). */
export async function DefinitionsTab({ ctx }: { ctx: TabContext }) {
  const snapshot = definitionsFromSettings(await getSettings(definitionKeys(), { tenantId: ctx.tenantId }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Tanımlar ofis ayar kayıt defterine yazılır: her değişiklik doğrulanır, sürümlenir ve{" "}
        <Link href={tabHref("ayarlar")} className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
          Ayarlar sekmesinden <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>{" "}
        geçmişiyle geri alınabilir.
      </p>
      <DefinitionsForm initial={snapshot} canEdit={ctx.canEditSettings} notifyLabels={NOTIFY_DEFAULTS.map((n) => ({ id: n.id, label: n.label, description: n.description }))} />
    </div>
  );
}
