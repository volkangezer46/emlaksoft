import { createClient } from "@/lib/supabase/server";
import { readLatestListingAnalysis } from "@/lib/ef-credits/listing-analysis";
import { ListingAnalysisPanel } from "./listing-analysis-panel";

/**
 * İlan analizi kartı (sunucu): son kayıtlı sonucu okur ve istemci paneline verir. KONTÖRSÜZDÜR (kontör yalnız
 * değerleme için harcanır). Portföy detayı (Fiyat sekmesi) ve Değerleme sayfasında (?property=) kullanılır.
 */
export async function ListingAnalysisCard({ propertyId, tenantId, canRun }: { propertyId: string; tenantId: string; canRun: boolean }) {
  const supabase = await createClient();
  const latest = await readLatestListingAnalysis(supabase, tenantId, propertyId);
  return (
    <ListingAnalysisPanel
      propertyId={propertyId}
      canRun={canRun}
      initial={latest ? { result: latest.result, createdAt: latest.createdAt, unitsCharged: latest.unitsCharged } : null}
    />
  );
}
