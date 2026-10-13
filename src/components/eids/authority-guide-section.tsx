import "server-only";
import { createClient } from "@/lib/supabase/server";
import { EidsAuthorityGuidePanel } from "./authority-guide-panel";

/**
 * Sayfa sarmalayıcı (Suspense içinde akar; kuyruğu bekletmez): ofisin yetki belgesi no durumunu okur. Alma adresi EP3'ün
 * okuyucusundan gelir; okuyucu bağlanana kadar `address` boştur ve kılavuz Ayarlar kartına yönlendirir.
 */
export async function EidsAuthorityGuideSection({ tenantId, address = null }: { tenantId: string | null | undefined; address?: string | null }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("license_no").eq("id", tenantId).maybeSingle();
  const licenseMissing = !String((data as { license_no?: string | null } | null)?.license_no ?? "").trim();
  return <EidsAuthorityGuidePanel address={address} licenseMissing={licenseMissing} />;
}
