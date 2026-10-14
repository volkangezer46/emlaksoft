import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/listing-control/server/db";

/**
 * EİDS e-posta saklama (KVKK; operational-retention cron'unun ayrık adımı, yeni cron YOK):
 *  - Ham .eml: `raw_purge_after` (alımdan 30 gün sonra) geçen satırlarda `raw_eml_encrypted` NULL'lanır. Ayrıştırılmış
 *    alanlar (no, tür, maskeli malik, bitiş), doğrulama sonucu ve durum KALIR.
 *  - İletme onay kodu/bağlantısı: 24 saati (`confirm_expires_at`) geçince silinir.
 * Tablo yoksa (migration uygulanmamış) 'skipped'. İdempotent. Çağıran tembel service_role istemcisini verir
 * (yeni createAdminClient kullanımı doğmaz).
 */
export async function purgeEidsInboundRaw(
  admin: SupabaseClient,
  opts: { nowMs: number },
): Promise<{ rawPurged: number; confirmationsCleared: number } | { skipped: true }> {
  const nowIso = new Date(opts.nowMs).toISOString();
  const raw = await admin
    .from("eids_inbound_messages")
    .update({ raw_eml_encrypted: null })
    .not("raw_eml_encrypted", "is", null)
    .lt("raw_purge_after", nowIso)
    .select("id");
  if (raw.error) {
    if (isMissingSchema(raw.error)) return { skipped: true };
    throw new Error(`eids raw purge failed: ${raw.error.code}`);
  }
  const conf = await admin
    .from("eids_inbound_messages")
    .update({ confirm_code: null, confirm_url: null })
    .lt("confirm_expires_at", nowIso)
    .or("confirm_code.not.is.null,confirm_url.not.is.null")
    .select("id");
  if (conf.error) throw new Error(`eids confirmation purge failed: ${conf.error.code}`);
  return { rawPurged: (raw.data ?? []).length, confirmationsCleared: (conf.data ?? []).length };
}
