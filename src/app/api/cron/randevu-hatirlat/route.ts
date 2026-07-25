import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const from = new Date();
  const to = new Date(Date.now() + 24 * 86_400_000);
  const { data: appts } = await admin
    .from("appointments")
    .select("id, tenant_id, appointment_type, scheduled_at, customer:customers(full_name)")
    .gte("scheduled_at", from.toISOString())
    .lte("scheduled_at", to.toISOString())
    .neq("status", "cancelled")
    .limit(200);

  const windowStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const list = appts ?? [];

  // N+1 KALDIRILDI: randevu başına 1 SELECT + 1 INSERT yerine toplam 2 sorgu.
  // Bu cron her 30 dakikada bir çalışıyor, yani kazanç en çok burada birikiyor.
  const tenantIds = [...new Set(list.map((a) => String(a.tenant_id)))];
  const alreadyNotified = await findNotifiedIds(admin, {
    href: "/app/randevular",
    tenantIds,
    sinceIso: windowStart,
    markerPrefix: "appt",
  });

  const toInsert: NotificationRow[] = [];
  let skipped = 0;

  for (const a of list) {
    if (alreadyNotified.has(String(a.id).toLowerCase())) {
      skipped += 1;
      continue;
    }
    const cust = a.customer as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;
    toInsert.push({
      tenant_id: String(a.tenant_id),
      title: "Yaklaşan randevu",
      body: `${name ?? "Müşteri"} · ${new Date(a.scheduled_at).toLocaleString("tr-TR")} · appt:${a.id}`,
      href: "/app/randevular",
      kind: "info",
    });
  }

  const notified = await insertNotifications(admin, toInsert);

  return NextResponse.json({ ok: true, notified, skipped });
}
