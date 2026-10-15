import { createClient } from "@/lib/supabase/server";
import { parseNearbyPlaces } from "@/lib/vitrin/nearby";
import { NearbyPlacesCard } from "./nearby-places-card";

/**
 * "Çevrede neler var" bölümü (PUB-8): kendi sorgusuyla akar (Suspense). Sütun yoksa (migration 20261019010001
 * uygulanmadı) kart "kurulum bekliyor" der; sayfa bozulmaz.
 */
export async function NearbyPlacesSection({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("properties").select("nearby_places").eq("id", propertyId).maybeSingle();
  const available = !error;
  const places = available ? parseNearbyPlaces((data as { nearby_places?: unknown } | null)?.nearby_places) : [];
  return <NearbyPlacesCard propertyId={propertyId} initial={places} canEdit={canEdit && available} available={available} />;
}
