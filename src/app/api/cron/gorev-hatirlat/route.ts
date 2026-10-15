import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor, failureNote } from "@/lib/cron-heartbeat-status";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { formatDateTimeTr } from "@/lib/format";
import { fetchAllPaged, guardCron } from "@/lib/cron-run";
import { runLowScoreEscalation, type LowScoreEscalationSummary } from "@/lib/surveys/escalate";
import { runPlatformTaskReminders, runTenantHealthDaily, type HealthJobSummary, type TaskReminderSummary } from "@/lib/admin/tenant-health-job";
import { runEidsActionSweep, type EidsSweepSummary } from "@/lib/eids/actions";
import { cronStepsFailed, runCronSteps } from "@/lib/cron-steps";

/** Üst sınır: 10 sayfa x 1000. Aşılırsa heartbeat'e yazılır (sessiz kesme yok); vadesi en eski olanlar önce işlenir. */
const MAX_PAGES = 10;

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("gorev-hatirlat", req);
  if (pausedRun) return pausedRun;

  const admin = createAdminClient();
  const now = Date.now();
  const to = new Date(now + 24 * 3600_000);

  // BEŞ BAĞIMSIZ ADIM (runCronSteps): görev hatırlatması, düşük puan zinciri, platform görevleri, sağlık skoru, EİDS.
  // Biri hata verirse (fırlatırsa) öbürleri yine çalışır; hata adım adıyla heartbeat'e yazılır. Eskiden görev listesi
  // okunamayınca rota erken dönüyor, diğer dört adım o tur hiç çalışmıyordu.
  let capped = false;
  let processed = 0;
  const outcome = await runCronSteps({
    // Açık, atanmış ve önümüzdeki 24 saatte (veya geçmişte) vadesi gelen görevler.
    // Sabit .limit(300) tavanı KALDIRILDI: eskiden 300'ü aşan açık görevden fazlası hiç hatırlatılmıyordu (sıralamasız kesme).
    // Artık vade sırasıyla (en eski önce, id ile kararlı) sayfalanır; tavana dayanırsa heartbeat bunu açıkça söyler.
    tasks: async () => {
      const { rows: list, error: listError } = await fetchAllPaged<{ id: string; tenant_id: string; title: string; due_at: string | null; assigned_to: string }>(
        (from, upTo) =>
          admin
            .from("tasks")
            .select("id, tenant_id, title, due_at, assigned_to")
            .eq("status", "open")
            .not("assigned_to", "is", null)
            .not("due_at", "is", null)
            .lte("due_at", to.toISOString())
            .order("due_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, upTo),
        1000,
        MAX_PAGES,
      );
      capped = Boolean(listError && listError.startsWith("sayfa üst sınırı"));
      if (listError && !capped && list.length === 0) throw new Error("görev listesi okunamadı");
      processed = list.length;

      // N+1 KALDIRILDI: eskiden görev başına 1 SELECT + 1 INSERT vardı
      // (300 görev → 600 gidiş-dönüş). Artık 2 sorgu: pencereye giren
      // bildirimler bir kez çekiliyor, yeni olanlar tek insert ile yazılıyor.
      const windowStart = new Date(now - 20 * 3600_000).toISOString();
      const tenantIds = [...new Set(list.map((t) => String(t.tenant_id)))];
      const alreadyNotified = await findNotifiedIds(admin, {
        href: "/app/gorevler",
        tenantIds,
        sinceIso: windowStart,
        markerPrefix: "task",
      });

      const toInsert: NotificationRow[] = [];
      let skipped = 0;
      for (const t of list) {
        if (alreadyNotified.has(String(t.id).toLowerCase())) {
          skipped += 1;
          continue;
        }
        const overdue = new Date(t.due_at as string).getTime() < now;
        toInsert.push({
          tenant_id: String(t.tenant_id),
          user_id: t.assigned_to,
          title: overdue ? "Geciken görev" : "Yaklaşan görev",
          body: `${t.title} · ${formatDateTimeTr(t.due_at as string)} · task:${t.id}`,
          href: "/app/gorevler",
          kind: overdue ? "warning" : "info",
        });
      }
      const ins = await insertNotificationsDetailed(admin, toInsert);
      return { notified: ins.written, skipped, failed: ins.failed };
    },
    // Anket düşük puan zinciri (24 sa takım lideri, 48 sa ofis sahibi).
    lowScore: () => runLowScoreEscalation(admin, now),
    // Ofis CRM (AD5): platform görev hatırlatması + günde bir sağlık skoru.
    platformTasks: () => runPlatformTaskReminders(admin, now),
    health: () => runTenantHealthDaily(admin, now),
    // EİDS aksiyon motoru (yeni cron yok): kaçan yetki olayları, süre bitimi kaldırma görevi, 48 saat yükseltme,
    // eşleştir kuyruğu günlük bildirimi, Pazartesi "Yetki doğrula" özeti.
    eids: () => runEidsActionSweep(admin, now),
  });

  const r = outcome.results;
  const tasks = r.tasks as { notified: number; skipped: number; failed: number } | undefined;
  const lowScore = r.lowScore as LowScoreEscalationSummary | undefined;
  const platformTasks = r.platformTasks as TaskReminderSummary | undefined;
  const health = r.health as HealthJobSummary | undefined;
  const eids = r.eids as EidsSweepSummary | undefined;

  let failed = Object.keys(outcome.errors).length + (tasks?.failed ?? 0);
  if (platformTasks?.error) failed += 1;
  if (health?.error) failed += 1;
  if (eids) failed += eids.errors;

  const taskNote = tasks ? `${tasks.notified} bildirim, ${tasks.skipped} atlandı` : "görev hatırlatması hata verdi";
  const lowNote = lowScore ? `${lowScore.escalated} kademe, ${lowScore.notified} bildirim` : "hata verdi";
  const platformNote = !platformTasks
    ? "hata verdi"
    : `${platformTasks.skipped ? "atlandı" : `${platformTasks.notified} bildirim`}${platformTasks.error ? ` (hata: ${platformTasks.error.slice(0, 80)})` : ""}`;
  const healthNote = !health
    ? "hata verdi"
    : `${health.skipped ? "atlandı" : `${health.written} ofis`}${health.error ? ` (hata: ${health.error.slice(0, 80)})` : ""}`;
  const eidsNote = eids
    ? ` · EİDS: ${eids.events} olay, ${eids.created + eids.expired} kaldırma/yayın görevi, ${eids.escalated} yükseltme, ${eids.unmatchedNotified + eids.weeklyNotified} bildirim${eids.schemaMissing.length ? ` (kurulum bekliyor: ${[...new Set(eids.schemaMissing)].join(",")})` : ""}`
    : " · EİDS adımı hata verdi";
  const stepErrors = Object.entries(outcome.errors);
  const errorNote = stepErrors.length
    ? ` · başarısız adım: ${stepErrors.map(([step, msg]) => `${step} (${msg.slice(0, 80)})`).join(", ")}`
    : "";

  await recordHeartbeat(
    "gorev-hatirlat",
    heartbeatFor({ failed, truncated: capped }),
    `${taskNote} · düşük puan zinciri: ${lowNote} · platform görevi: ${platformNote} · sağlık skoru: ${healthNote}${eidsNote}${errorNote}${failureNote({ failed })}${capped ? ` · TAVAN: yalnız vadesi en eski ${processed} görev işlendi, kalanı bu turda İŞLENMEDİ` : ""}`,
  );

  if (cronStepsFailed(outcome)) {
    return NextResponse.json(
      { ok: false, error: "gorev_hatirlat_failed", failedSteps: Object.keys(outcome.errors), notified: tasks?.notified ?? 0 },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, notified: tasks?.notified ?? 0, skipped: tasks?.skipped ?? 0, lowScoreEscalated: lowScore?.escalated ?? 0 });
}

export const GET = guardCron("gorev-hatirlat", run);
