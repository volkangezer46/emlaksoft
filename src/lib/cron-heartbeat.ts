import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cron kalp atışı: her cron çalışmasının SONUNDA tek satır upsert.
 *
 * /admin/sistem "Cron sağlığı" kartı bu tabloyu okur ve her işin kendi
 * zamanlamasına göre gecikme hesabı yapar. Kayıt başarısız olursa cron'un asıl
 * işi etkilenmez; sonuç false olur ve güvenli bir sunucu kaydı bırakılır.
 */
export async function recordHeartbeat(
  job: string,
  status: "ok" | "error" = "ok",
  detail?: string,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("cron_heartbeats").upsert(
      {
        job,
        last_run_at: new Date().toISOString(),
        last_status: status,
        // Detay serbest metin (ör. "3 bildirim, 1 atlandı") — 500'de kırp.
        last_detail: detail ? detail.slice(0, 500) : null,
      },
      { onConflict: "job" },
    );
    if (error) {
      console.error("cron heartbeat yazılamadı", { job, code: error.code });
      return false;
    }
    return true;
  } catch (err) {
    console.error("cron heartbeat yazılamadı", {
      job,
      error: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}
