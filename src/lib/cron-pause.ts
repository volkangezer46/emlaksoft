import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";

/**
 * Cron çalışma başlangıcı ve iş bazında DURAKLATMA (cron_job_state.paused).
 *
 * Her cron route'u yetki kapısından hemen sonra `beginCronRun(iş, istek)` çağırır:
 *  1) süre ölçümü için başlangıç anı not edilir (`recordHeartbeat` bitişte `cron_runs`'a süreyi yazar),
 *  2) iş duraklatıldıysa zamanlanmış çağrıda 200 + `skipped: "paused"` döner ve route erken çıkar.
 * "Şimdi çalıştır" (elle tetikleme başlığı) duraklatmayı aşar. Durum tablosu yoksa/okunamazsa iş ÇALIŞIR:
 * okunamayan bir bayrak yüzünden işlerin sessizce durması daha zararlıdır.
 *
 * Ayrı modül: route testleri `@/lib/cron-heartbeat`'i yalnız `recordHeartbeat` ile taklit eder.
 */

/** Elle tetikleme başlığı (runCronJobNow koyar). İstek zaten CRON_SECRET ile yetkili olduğundan güvenilir. */
export const CRON_TRIGGER_HEADER = "x-emlaksoft-cron-trigger";

export type CronRunStart = { at: number; trigger: "schedule" | "manual" };

/** Süreç içi başlangıç kaydı (tek uzun ömürlü Node süreci; iş adı başına son başlangıç). */
const runStarts = new Map<string, CronRunStart>();

/** Başlangıç kaydı bu süreden eskiyse süre yazılmaz (kopuk/çakışan çalışma). */
const MAX_RUN_MS = 15 * 60_000;

export function cronTriggerOf(req: Pick<Request, "headers"> | null | undefined): CronRunStart["trigger"] {
  return req?.headers.get(CRON_TRIGGER_HEADER) === "manual" ? "manual" : "schedule";
}

/** Bitişte başlangıcı alır ve siler. Kayıt yoksa null; çok eskiyse `at` null (süre yazılmaz, tetikleyici korunur). */
export function takeCronRunStart(job: string, finishedMs: number): { at: number | null; trigger: CronRunStart["trigger"] } | null {
  const start = runStarts.get(job);
  runStarts.delete(job);
  if (!start) return null;
  return { at: finishedMs - start.at <= MAX_RUN_MS ? start.at : null, trigger: start.trigger };
}

/** Duraklatma kontrolü olmadan başlangıç notu (ayrık adımlar, ör. uyarı motoru: süre `cron_runs`'a yazılsın). */
export function noteCronRunStart(job: string, trigger: CronRunStart["trigger"] = "schedule"): void {
  runStarts.set(job, { at: now(), trigger });
}

export async function beginCronRun(job: string, req?: Pick<Request, "headers"> | null): Promise<Response | null> {
  const trigger = cronTriggerOf(req);
  runStarts.set(job, { at: now(), trigger });
  if (trigger === "manual") return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("cron_job_state").select("paused").eq("job", job).maybeSingle();
    if (error || !(data as { paused?: boolean } | null)?.paused) return null;
  } catch {
    return null;
  }
  runStarts.delete(job);
  return NextResponse.json({ ok: true, skipped: "paused", job });
}
