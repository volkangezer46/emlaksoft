import { computeMissingPortals, type PortalGap } from "@/lib/portal-transfer/gaps";
import { isMissingSchema, type Db } from "@/lib/listing-control/server/db";

/**
 * Eksik portal okuyucusu (kullanıcı oturumu / RLS; service_role yok). Canlı (yayında) portföy kimlikleri ve canlı portal ilanları
 * sayfalanarak okunur (en çok 5000 portföy); okunamazsa `available: false` (kart gösterilmez, yanlış sayı üretilmez).
 */
const PAGE = 1000;
const MAX = 5000;

export async function loadPortalGaps(db: Db): Promise<{ available: boolean; gaps: PortalGap[] }> {
  const props: string[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await db
      .from("properties")
      .select("id")
      .eq("status", "live")
      .is("deleted_at", null)
      .not("is_sample", "is", true)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (!isMissingSchema(error)) console.error("portal gaps properties", { code: error.code });
      return { available: false, gaps: [] };
    }
    props.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    if ((data ?? []).length < PAGE) break;
  }
  const listings: { propertyId: string; portal: string }[] = [];
  for (let from = 0; from < MAX * 4; from += PAGE) {
    const { data, error } = await db
      .from("portal_listings")
      .select("property_id, portal_name")
      .eq("status", "live")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (!isMissingSchema(error)) console.error("portal gaps listings", { code: error.code });
      return { available: false, gaps: [] };
    }
    for (const r of (data ?? []) as { property_id: string; portal_name: string }[]) listings.push({ propertyId: r.property_id, portal: r.portal_name });
    if ((data ?? []).length < PAGE) break;
  }
  return { available: true, gaps: computeMissingPortals(props, listings) };
}
