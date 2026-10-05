import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { formatDateTimeTr } from "@/lib/format";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const to = new Date(Date.now() + 24 * 3600_000);

  // Açık, atanmış ve önümüzdeki 24 saatte (veya geçmişte) vadesi gelen görevler
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, tenant_id, title, due_at, assigned_to")
    .eq("status", "open")
    .not("assigned_to", "is", null)
    .not("due_at", "is", null)
    .lte("due_at", to.toISOString())
    .limit(300);

  const windowStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const now = Date.now();
  const list = tasks ?? [];

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

  const notified = await insertNotifications(admin, toInsert);

  await recordHeartbeat("gorev-hatirlat", "ok", `${notified} bildirim, ${skipped} atlandı`);

  return NextResponse.json({ ok: true, notified, skipped });
}
