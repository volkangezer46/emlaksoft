import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { takeCronRunStart } from "@/lib/cron-pause";

/**
 * Cron kalp atışı: her cron çalışmasının SONUNDA tek satır upsert + çalışma geçmişine (cron_runs) bir satır.
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
  const finished = now();
  const start = takeCronRunStart(job, finished);
  const startedAt = start?.at ?? null;
  // Detay serbest metin (ör. "3 bildirim, 1 atlandı") — 500'de kırp.
  const shortDetail = detail ? detail.slice(0, 500) : null;
  try {
    const admin = createAdminClient();
    const [{ error }, run] = await Promise.all([
      admin.from("cron_heartbeats").upsert(
        {
          job,
          last_run_at: new Date(finished).toISOString(),
          last_status: status,
          last_detail: shortDetail,
        },
        { onConflict: "job" },
      ),
      // Çalışma geçmişi: tablo yoksa (migration bekliyor) hata yutulur; kalp atışı sonucu bundan etkilenmez.
      admin.from("cron_runs").insert({
        job,
        started_at: new Date(startedAt ?? finished).toISOString(),
        finished_at: new Date(finished).toISOString(),
        duration_ms: startedAt === null ? null : Math.max(0, Math.round(finished - startedAt)),
        status,
        trigger: start?.trigger ?? "schedule",
        detail: shortDetail,
      }),
    ]);
    if (run.error && run.error.code !== "42P01" && run.error.code !== "PGRST205") {
      console.error("cron çalışma kaydı yazılamadı", { job, code: run.error.code });
    }
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
