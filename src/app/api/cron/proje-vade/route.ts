import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { logActivity } from "@/lib/activity";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Proje ödeme planı vade cron'u — günlük çalışacak şekilde idempotent:
 *  1. Vadesi (due_date) geçmiş 'pending' unit_payments satırlarını 'overdue' yapar.
 *  2. Geciken taksiti olan her tenant'a GÜNDE TEK toplu bildirim yazar
 *     ("Projelerde N geciken taksit — toplam ₺X", href /app/projeler).
 *     Mükerrer freni: bildirim gövdesindeki `projevade:<tenant_id>` marker'ı
 *     20 saatlik pencerede aranır (gorev-hatirlat ile aynı desen).
 *  3. Süresi (reserved_until) geçmiş 'reserved' daireleri otomatik 'available'a
 *     döndürür (customer_id/reserved_until temizlenir) + tenant başına GÜNDE TEK
 *     toplu bildirim ("N rezervasyon süresi doldu", marker `projerezerv:<tenant_id>`).
 *     'deposit' durumuna DOKUNULMAZ — kapora alınmış, otomatik düşmez.
 *
 * NOT: vercel.json'a bilerek DOKUNULMADI — cron path: /api/cron/proje-vade
 * (CRON_SECRET Bearer başlığıyla çağrılır).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // ---- 1) Vadesi geçmiş pending → overdue ----
  const { data: flipped, error: flipErr } = await admin
    .from("unit_payments")
    .update({ status: "overdue" })
    .eq("status", "pending")
    .lt("due_date", today)
    .select("id");

  if (flipErr) {
    console.error("proje-vade cron overdue", flipErr);
    await recordHeartbeat("proje-vade", "error", "overdue güncellemesi başarısız");
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  const overdueFlipped = (flipped ?? []).length;

  // ---- 2) Tenant başına toplu gecikme bildirimi (günde tek) ----
  const { data: overdueRows, error: overdueErr } = await admin
    .from("unit_payments")
    .select("tenant_id, amount")
    .eq("status", "overdue")
    .limit(5000);

  if (overdueErr) {
    console.error("proje-vade cron query", overdueErr);
    await recordHeartbeat("proje-vade", "error", "gecikme sorgusu başarısız");
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const byTenant = new Map<string, { count: number; sum: number }>();
  for (const r of overdueRows ?? []) {
    const t = String(r.tenant_id);
    const agg = byTenant.get(t) ?? { count: 0, sum: 0 };
    agg.count += 1;
    agg.sum += Number(r.amount) || 0;
    byTenant.set(t, agg);
  }

  const tenantIds = [...byTenant.keys()];
  const windowStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const alreadyNotified = await findNotifiedIds(admin, {
    href: "/app/projeler",
    tenantIds,
    sinceIso: windowStart,
    markerPrefix: "projevade",
  });

  const toInsert: NotificationRow[] = [];
  for (const [tenantId, agg] of byTenant) {
    if (alreadyNotified.has(tenantId.toLowerCase())) continue;
    const tutar = new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(agg.sum);
    toInsert.push({
      tenant_id: tenantId,
      title: "Geciken proje taksitleri",
      body: `Projelerde ${agg.count} geciken taksit — toplam ${tutar} · projevade:${tenantId}`,
      href: "/app/projeler",
      kind: "warning",
    });
  }

  const notified = await insertNotifications(admin, toInsert);

  // ---- 3) Süresi dolan rezervasyonları serbest bırak ('deposit'e DOKUNMA) ----
  const nowIso = new Date().toISOString();
  const { data: released, error: releaseErr } = await admin
    .from("project_units")
    .update({ status: "available", customer_id: null, reserved_until: null })
    .eq("status", "reserved")
    .not("reserved_until", "is", null)
    .lt("reserved_until", nowIso)
    .select("id, tenant_id, project_id, unit_no");

  if (releaseErr) {
    console.error("proje-vade cron reservation release", releaseErr);
    await recordHeartbeat("proje-vade", "error", "rezervasyon serbest bırakma başarısız");
    return NextResponse.json({ error: "release_failed" }, { status: 500 });
  }
  const releasedCount = (released ?? []).length;

  for (const u of released ?? []) {
    await logActivity({
      tenantId: String(u.tenant_id),
      action: "project_unit.reservation_expired",
      entityType: "project_unit",
      entityId: String(u.id),
      newValue: { project_id: u.project_id, unit_no: u.unit_no, status: "available" },
    });
  }

  // Tenant başına toplu bildirim (günde tek — projerezerv marker freni)
  const releasedByTenant = new Map<string, number>();
  for (const u of released ?? []) {
    const t = String(u.tenant_id);
    releasedByTenant.set(t, (releasedByTenant.get(t) ?? 0) + 1);
  }
  const releaseNotified = await findNotifiedIds(admin, {
    href: "/app/projeler",
    tenantIds: [...releasedByTenant.keys()],
    sinceIso: windowStart,
    markerPrefix: "projerezerv",
  });
  const releaseInserts: NotificationRow[] = [];
  for (const [tenantId, count] of releasedByTenant) {
    if (releaseNotified.has(tenantId.toLowerCase())) continue;
    releaseInserts.push({
      tenant_id: tenantId,
      title: "Rezervasyon süresi doldu",
      body: `${count} rezervasyon süresi doldu ve serbest bırakıldı · projerezerv:${tenantId}`,
      href: "/app/projeler",
      kind: "info",
    });
  }
  const releaseNotifCount = await insertNotifications(admin, releaseInserts);

  await recordHeartbeat(
    "proje-vade",
    "ok",
    `${overdueFlipped} satır gecikmeye alındı, ${notified} bildirim, ${releasedCount} rezervasyon serbest`,
  );

  return NextResponse.json({
    ok: true,
    overdue: overdueFlipped,
    notified,
    released: releasedCount,
    releaseNotified: releaseNotifCount,
  });
}
