"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import { fetchExternal, readExternalText } from "@/lib/external-fetch";
import { actionErrorMessage } from "@/lib/action-errors";

export type CronRunResult = {
  ok?: boolean;
  error?: string;
  job?: string;
  status?: number;
  durationMs?: number;
  detail?: string;
};

const CRON_TIMEOUT_MS = 55_000;

/**
 * Zamanlanmış işi elle çalıştırır (yalnız süper admin, hız sınırlı).
 *
 * `CRON_SECRET` YALNIZ burada, sunucuda okunur ve istek başlığına konur; istemciye, yanıta veya
 * denetim kaydına asla yazılmaz. İş kendi `recordHeartbeat` kaydını yazar; elle tetikleme ayrıca
 * `platform_audit_logs`'a (`platform_cron.run`) düşer — "son çalışmalar" listesi buradan okunur.
 */
export async function runCronJobNow(fd: FormData): Promise<CronRunResult> {
  const gate = await guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-cron-run", limit: 6, windowSec: 600 },
  });
  if ("error" in gate) return { error: gate.error };

  const jobId = String(fd.get("job") ?? "").trim();
  const job = CRON_JOBS.find((j) => j.job === jobId);
  if (!job) return { error: "Bilinmeyen zamanlanmış iş." };

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") {
    return { error: "CRON_SECRET tanımlı değil; iş elle çalıştırılamaz." };
  }

  const started = now();
  let status = 0;
  let detail = "";
  try {
    const res = await fetchExternal(
      `${getBaseUrl()}${job.path}`,
      {
        method: "GET",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        cache: "no-store",
      },
      { timeoutMs: CRON_TIMEOUT_MS },
    );
    status = res.status;
    detail = (await readExternalText(res).catch(() => "")).slice(0, 400);
  } catch (e) {
    detail = e instanceof Error ? e.message.slice(0, 200) : "Bağlantı hatası";
  }
  const durationMs = now() - started;
  const ok = status >= 200 && status < 300;

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_cron.run",
    entityType: "cron_job",
    entityId: null,
    meta: { job: job.job, label: job.label, status, ok, duration_ms: durationMs },
  });

  revalidatePath("/admin/sistem");
  if (!ok) {
    return {
      error: status === 401 ? "İş yetkilendirmeyi reddetti (CRON_SECRET uyuşmuyor)." : actionErrorMessage(null, "İş başarısız oldu."),
      job: job.job,
      status,
      durationMs,
      detail,
    };
  }
  return { ok: true, job: job.job, status, durationMs, detail };
}
