import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { insertSampleRecords, SAMPLE_DATA_COUNTS } from "@/lib/sample-data-seed";

/**
 * Kayıtta "demo verileriyle başla" (sunucu; istemci import ETMEZ).
 *
 * Yeni kurulan ofise, "Dolu demo ile başla" yolundaki AYNI kayıt setini (`insertSampleRecords`) yükler;
 * tüm kayıtlar `is_sample=true` taşır, bu yüzden Ayarlar / ana ekran bandındaki "Gerçek kullanıma başla"
 * ile (`clearSampleData`) tek adımda silinir. Kayıt akışını ASLA bozmaz: hata yutulur, sonuç döner.
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
): Promise<RegistrationSeedResult> {
  try {
    const seed = await insertSampleRecords(db, tenantId, ownerId, { extrasDb: db, pack: "konut" });
    const stamp = new Date(now()).toISOString();
    const { error: markError } = await db.from("tenants").update({ sample_seeded_at: stamp }).eq("id", tenantId);
    if (markError) throw markError;
    // Genişletme migration'ı uygulanmamışsa sütun yoktur; sessizce atla.
    await db.from("tenants").update({ sample_pack: "konut", sample_cleared_at: null }).eq("id", tenantId);
    await logActivity({
      tenantId,
      actorId: ownerId,
      action: "sample_data.seed",
      entityType: "tenant",
      entityId: tenantId,
      newValue: {
        ...SAMPLE_DATA_COUNTS,
        by: "registration",
        pack: "konut",
        loaded: seed.counts,
        skipped: seed.skipped.map((x) => x.group),
        failed: seed.failed.map((x) => x.group),
      },
    });
    return { ok: true };
  } catch (e) {
    console.error("seedDemoDataForNewTenant", e);
    return { ok: false };
  }
}
