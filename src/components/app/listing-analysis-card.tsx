import { createClient } from "@/lib/supabase/server";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScanSearch } from "lucide-react";
import { getPlatformSetting } from "@/lib/platform-settings";
import { EF_TARIFF_SETTING_KEY, efUnitsFor, parseEfTariff } from "@/lib/ef-credits/config";
import { efCreditReady } from "@/lib/ef-credits/wallet";
import { readLatestListingAnalysis } from "@/lib/ef-credits/listing-analysis";
import { ListingAnalysisPanel } from "./listing-analysis-panel";

/**
 * İlan analizi kartı (sunucu): son kayıtlı sonucu okur, tarifeden kontör bedelini gösterir, istemci paneline verir.
 * Cüzdan şeması hazır değilse kart "etkin değil" der ve hiçbir kontör işlemi yapılmaz. Portföy detayı (Fiyat sekmesi) ve
 * Değerleme sayfasında (?property=) kullanılır.
 */
export async function ListingAnalysisCard({ propertyId, tenantId, canRun }: { propertyId: string; tenantId: string; canRun: boolean }) {
  const [ready, tariffRaw] = await Promise.all([efCreditReady(), getPlatformSetting(EF_TARIFF_SETTING_KEY)]);
  if (!ready) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="h-4 w-4 text-text-faint" aria-hidden /> İlan analizi
            </CardTitle>
            <CardDescription>Bu özellik henüz etkinleştirilmedi.</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }
  const supabase = await createClient();
  const latest = await readLatestListingAnalysis(supabase, tenantId, propertyId);
  const units = efUnitsFor("listing_analysis", parseEfTariff(tariffRaw));
  return (
    <ListingAnalysisPanel
      propertyId={propertyId}
      units={units}
      canRun={canRun}
      initial={latest ? { result: latest.result, createdAt: latest.createdAt, unitsCharged: latest.unitsCharged } : null}
    />
  );
}
