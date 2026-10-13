import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor, failureNote } from "@/lib/cron-heartbeat-status";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { formatDateTimeTr } from "@/lib/format";
import { fetchAllPaged, guardCron } from "@/lib/cron-run";
import { runLowScoreEscalation } from "@/lib/surveys/escalate";
import { runEidsActionSweep, type EidsSweepSummary } from "@/lib/eids/actions";

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
  const to = new Date(Date.now() + 24 * 3600_000);

  // Açık, atanmış ve önümüzdeki 24 saatte (veya geçmişte) vadesi gelen görevler
  // Sabit .limit(300) tavanı KALDIRILDI: eskiden 300'ü aşan açık görevden fazlası hiç hatırlatılmıyordu (sıralamasız kesme).
  // Artık vade sırasıyla (en eski önce, id ile kararlı) sayfalanır; tavana dayanırsa heartbeat bunu açıkça söyler.
  const { rows: tasks, error: listError } = await fetchAllPaged<{ id: string; tenant_id: string; title: string; due_at: string | null; assigned_to: string }>(
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
  const capped = Boolean(listError && listError.startsWith("sayfa üst sınırı"));
  if (listError && !capped && tasks.length === 0) {
    await recordHeartbeat("gorev-hatirlat", "error", "görev listesi okunamadı");
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
  }

  const windowStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const now = Date.now();
  const list = tasks;

  // N+1 KALDIRILDI: eskiden görev başına 1 SELECT + 1 INSERT vardı
  // (300 görev → 600 gidiş-dönüş). Artık 2 sorgu: pencereye giren
  // bildirimler bir kez çekiliyor, yeni olanlar tek insert ile yazılıyor.
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
  const notified = ins.written;
  let failed = ins.failed;

  // Anket düşük puan zinciri (24 sa takım lideri, 48 sa ofis sahibi). Hata görev hatırlatmasını bozmaz.
  let lowScore = { escalated: 0, notified: 0, skipped: true };
  try {
    lowScore = await runLowScoreEscalation(admin, now);
  } catch (e) {
    console.error("gorev-hatirlat düşük puan zinciri", e);
    failed += 1;
  }

  // EİDS aksiyon motoru (ayrık adım; yeni cron yok): kaçan yetki olayları, süre bitimi kaldırma görevi, 48 saat yükseltme,
  // eşleştir kuyruğu günlük bildirimi, Pazartesi "Yetki doğrula" özeti. Hata görev hatırlatmasını bozmaz.
  let eids: EidsSweepSummary | null = null;
  try {
    eids = await runEidsActionSweep(admin, now);
    failed += eids.errors;
  } catch (e) {
    console.error("gorev-hatirlat eids", e instanceof Error ? e.message : "hata");
    failed += 1;
  }
  const eidsNote = eids
    ? ` · EİDS: ${eids.events} olay, ${eids.created + eids.expired} kaldırma/yayın görevi, ${eids.escalated} yükseltme, ${eids.unmatchedNotified + eids.weeklyNotified} bildirim${eids.schemaMissing.length ? ` (kurulum bekliyor: ${[...new Set(eids.schemaMissing)].join(",")})` : ""}`
    : " · EİDS adımı hata verdi";

  await recordHeartbeat(
    "gorev-hatirlat",
    heartbeatFor({ failed, truncated: capped }),
    `${notified} bildirim, ${skipped} atlandı · düşük puan zinciri: ${lowScore.escalated} kademe, ${lowScore.notified} bildirim${eidsNote}${failureNote({ failed })}${capped ? ` · TAVAN: yalnız vadesi en eski ${list.length} görev işlendi, kalanı bu turda İŞLENMEDİ` : ""}`,
  );

  return NextResponse.json({ ok: true, notified, skipped, lowScoreEscalated: lowScore.escalated });
}

export const GET = guardCron("gorev-hatirlat", run);
