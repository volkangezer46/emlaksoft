import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/read";
import { BROADCAST_SETTING_KEYS } from "@/lib/settings/registry/broadcast";
import { processAnnouncementQueue, type QueueSummary } from "./queue";

/**
 * Duyuru kuyruğunu çalıştırır (platform işi; kiracılar arası, hedef segmentten gelir). İki çağıran:
 * campaign-delivery cron'unun AYRIK adımı (yeni cron rotası eklenmedi) ve gönderim anındaki after().
 * ASLA fırlatmaz: hata özetin `error` alanında döner; cron ana işi bundan etkilenmez.
 */
export async function runAnnouncementQueue(opts?: { announcementId?: string; budgetMs?: number; maxBudgetMs?: number }): Promise<QueueSummary & { error?: string }> {
  try {
    const settings = await getSettings([BROADCAST_SETTING_KEYS.batchSize, BROADCAST_SETTING_KEYS.budgetSeconds, BROADCAST_SETTING_KEYS.emailRatePerSec]).catch(
      () => ({}) as Record<string, unknown>,
    );
    const batchSize = Number(settings[BROADCAST_SETTING_KEYS.batchSize] ?? 200) || 200;
    const budgetSec = Number(settings[BROADCAST_SETTING_KEYS.budgetSeconds] ?? 25) || 25;
    const emailRatePerSec = Number(settings[BROADCAST_SETTING_KEYS.emailRatePerSec] ?? 2) || 2;
    const admin = createAdminClient();
    return await processAnnouncementQueue(admin, {
      // maxBudgetMs: çağıranın üst sınırı (cron adımı kampanya işine süre bırakır).
      budgetMs: Math.min(opts?.budgetMs ?? budgetSec * 1000, opts?.maxBudgetMs ?? 45_000, 45_000),
      batchSize,
      announcementId: opts?.announcementId,
      emailRatePerSec,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "duyuru_kuyrugu_hatasi";
    console.error("duyuru kuyruğu", error);
    return { materialized: 0, delivered: 0, failed: 0, skipped: 0, finished: 0, budgetHit: false, error };
  }
}
