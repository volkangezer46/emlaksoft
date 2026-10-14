import "server-only";
import { getEffectiveLegalValues } from "@/lib/legal-constants/store";
import { createClient } from "@/lib/supabase/server";
import { EidsAuthorityGuidePanel } from "./authority-guide-panel";

/**
 * Sayfa sarmalayıcı (Suspense içinde akar; kuyruğu bekletmez): ofisin yetki belgesi no durumunu okur. Alma adresi EP3'ün
 * okuyucusundan gelir; okuyucu bağlanana kadar `address` boştur ve kılavuz Ayarlar kartına yönlendirir. Ceza tutarı o gün
 * yürürlükteki mevzuat değeridir (`getEffectiveLegalValues()`; yılbaşı güncellemesi mevzuat panelinden).
 */
export async function EidsAuthorityGuideSection({ tenantId, address = null }: { tenantId: string | null | undefined; address?: string | null }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const [{ data }, legalValues] = await Promise.all([
    supabase.from("tenants").select("license_no").eq("id", tenantId).maybeSingle(),
    getEffectiveLegalValues(),
  ]);
  const licenseMissing = !String((data as { license_no?: string | null } | null)?.license_no ?? "").trim();
  return <EidsAuthorityGuidePanel address={address} licenseMissing={licenseMissing} legalValues={legalValues} />;
}
