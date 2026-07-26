import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

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
    .select("id, tenant_id, appointment_type, scheduled_at, confirm_token, customer:customers(full_name)")
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
    // Teyit linki mesajın gövdesinde: danışman SMS/WhatsApp'a kopyalarken hazır
    // olsun. Kısa tutuluyor (mesaj SMS'e gidebilir); appt:{id} işareti dedupe
    // için SONDA kalmalı (findNotifiedIds markerPrefix bunu okur).
    const teyit = a.confirm_token ? ` · Teyit: ${APP_URL}/randevu-teyit/${a.confirm_token}` : "";
    toInsert.push({
      tenant_id: String(a.tenant_id),
      title: "Yaklaşan randevu",
      body: `${name ?? "Müşteri"} · ${new Date(a.scheduled_at).toLocaleString("tr-TR")}${teyit} · appt:${a.id}`,
      href: "/app/randevular",
      kind: "info",
    });
  }

  const notified = await insertNotifications(admin, toInsert);

  await recordHeartbeat("randevu-hatirlat", "ok", `${notified} hatırlatma, ${skipped} atlandı`);

  return NextResponse.json({ ok: true, notified, skipped });
}
