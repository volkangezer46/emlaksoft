import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * KVKK saklama (OA9): sonuçlanan (katıldı / olumsuz) adayı ofisin saklama süresi dolunca, hareketsiz açık başvuruyu
 * aynı süre sonra siler (`recruit_purge_expired`, yalnız service_role; tek turda en çok 5000). operational-retention
 * cron adımı. Fonksiyon yoksa (migration uygulanmadı) 'skipped'. İdempotent.
 */
export async function purgeExpiredRecruitCandidates(admin: SupabaseClient): Promise<{ removed: number } | { skipped: true }> {
  const { data, error } = await admin.rpc("recruit_purge_expired");
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") return { skipped: true };
    throw new Error(`recruit_purge_expired failed: ${error.code}`);
  }
  return { removed: Number(data ?? 0) };
}
