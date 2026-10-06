import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureSampleData } from "@/lib/sample-data/seed";
import type { SamplePack } from "@/lib/sample-data-seed";

/**
 * Kayıtta "demo verileriyle başla" (sunucu; istemci import ETMEZ).
 *
 * Yeni kurulan ofise, "Örnek veriyle başla" yolundaki AYNI kayıt setini yükler (tek kaynak `sample-data-seed.ts`,
 * idempotent çekirdek `sample-data/seed.ts`). Tüm kayıtlar `is_sample=true` taşır; Ayarlar > Gerçek kullanıma geç
 * (`purge_tenant_sample_data`) ile tek adımda silinir. Kayıt akışını ASLA bozmaz: hata yutulur, sonuç döner.
 * `db` çağıranın (signUp) zaten elindeki service_role client'ıdır; yeni createAdminClient çağrısı yoktur.
 */

/** Form alanı adı: işaretli onay kutusu "on" gönderir; alan yoksa demo yüklenmez. */
export const REGISTRATION_DEMO_FIELD = "demo_data";

/** Kayıtta demo veri yüklenemediyse set edilen çerez; ana ekran "yeniden dene" bandını tetikler. */
export const DEMO_SEED_FAILED_COOKIE = "es_demo_seed_failed";

export function wantsDemoData(formData: FormData): boolean {
  const v = String(formData.get(REGISTRATION_DEMO_FIELD) ?? "");
  return v === "on" || v === "1" || v === "true";
}

export type RegistrationSeedResult = { ok: boolean };

export async function seedDemoDataForNewTenant(
  db: SupabaseClient,
  tenantId: string,
  ownerId: string,
  pack: SamplePack = "konut",
): Promise<RegistrationSeedResult> {
  const res = await ensureSampleData(db, tenantId, ownerId, { pack, by: "registration" });
  return { ok: res.ok };
}
