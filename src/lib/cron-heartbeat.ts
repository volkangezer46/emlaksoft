import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cron kalp atışı: her cron çalışmasının SONUNDA tek satır upsert.
 *
 * /admin/sistem "Cron sağlığı" kartı bu tabloyu okur; 24 saatten eski kayıt
 * "gecikmiş" görünür. Kayıt başarısız olursa cron'un asıl işi ETKİLENMEZ —
 * hata yutulur ve yalnızca loglanır (izleme, işi düşürecek kadar önemli değil).
 */
export async function recordHeartbeat(
  job: string,
  status: "ok" | "error" = "ok",
  detail?: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("cron_heartbeats").upsert(
      {
        job,
        last_run_at: new Date().toISOString(),
        last_status: status,
        // Detay serbest metin (ör. "3 bildirim, 1 atlandı") — 500'de kırp.
        last_detail: detail ? detail.slice(0, 500) : null,
      },
      { onConflict: "job" },
    );
  } catch (err) {
    console.error("cron heartbeat yazılamadı", job, err);
  }
}
