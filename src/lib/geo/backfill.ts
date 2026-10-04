import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGeo } from "./resolve";
import type { GeoResolution } from "./types";

/**
 * Eski SERBEST METİN il alanlarının kimliğe bağlanması (geriye uyumlu "eşleştir" yolu).
 * Şimdilik: ofis kaydı (`tenants.city` metni, `province_id` boş). Tahmin yok: yalnız kesin
 * (tam/alias) eşleşmeler toplu uygulanır; yazım toleransıyla bulunanlar satır bazında onay ister;
 * belirsiz/bulunamayanlar "eşleşmeyen" raporunda kalır.
 */

export type TenantGeoCandidate = { tenantId: string; name: string; city: string; resolution: GeoResolution };

export async function listTenantGeoCandidates(limit = 500): Promise<{ rows: TenantGeoCandidate[]; total: number }> {
  const admin = createAdminClient();
  const { data, count } = await admin
    .from("tenants")
    .select("id, name, city", { count: "exact" })
    .is("province_id", null)
    .not("city", "is", null)
    .order("name")
    .limit(limit);
  const list = ((data ?? []) as Array<{ id: string; name: string; city: string | null }>).filter((t) => (t.city ?? "").trim());
  const rows = await Promise.all(
    list.map(async (t) => ({ tenantId: t.id, name: t.name, city: t.city as string, resolution: await resolveGeo({ province: t.city }) })),
  );
  return { rows, total: count ?? rows.length };
}

/** Seçili ofisleri sunucuda YENİDEN çözer; yalnız `ok` olanları (fuzzy yalnız `allowFuzzy` ile) yazar. */
export async function applyTenantGeoMatches(tenantIds: string[], allowFuzzy: boolean): Promise<{ applied: number; skipped: number }> {
  const admin = createAdminClient();
  const { data } = await admin.from("tenants").select("id, city").in("id", tenantIds).is("province_id", null);
  let applied = 0;
  let skipped = 0;
  for (const t of (data ?? []) as Array<{ id: string; city: string | null }>) {
    const res = await resolveGeo({ province: t.city });
    if (res.status !== "ok" || (res.via === "fuzzy" && !allowFuzzy) || !res.geo.provinceId) {
      skipped++;
      continue;
    }
    const { error } = await admin
      .from("tenants")
      .update({ province_id: res.geo.provinceId, city: res.geo.provinceName })
      .eq("id", t.id)
      .is("province_id", null);
    if (error) skipped++;
    else applied++;
  }
  return { applied, skipped };
}
