import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, findNotifiedKeys, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getBaseUrl } from "@/lib/base-url";
import { authorizeCron } from "@/lib/cron-auth";
import { fetchAllPaged, heartbeatFor } from "@/lib/cron-run";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { formatDateTimeTr } from "@/lib/format";

const APP_URL = getBaseUrl();

/** Çok ofisli toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

type ApptRow = {
  id: string;
  tenant_id: string;
  appointment_type: string | null;
  scheduled_at: string;
  confirm_token: string | null;
  customer: { full_name?: string } | { full_name?: string }[] | null;
};

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const startedAt = Date.now();
  const from = new Date(startedAt);
  const to = new Date(startedAt + 24 * 86_400_000);

  // Global .limit(200) kaldırıldı: order(id) + range sayfalama; sorgu hatası heartbeat'e 'error' olarak yansır.
  const { rows: list, error: listError } = await fetchAllPaged<ApptRow>(
    (rangeFrom, rangeTo) =>
      admin
        .from("appointments")
        .select("id, tenant_id, appointment_type, scheduled_at, confirm_token, customer:customers!appointments_customer_id_fkey(full_name)")
        .gte("scheduled_at", from.toISOString())
        .lte("scheduled_at", to.toISOString())
        .neq("status", "cancelled")
        .eq("is_sample", false)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{ data: ApptRow[] | null; error: { message: string } | null }>,
  );

  if (listError && list.length === 0) {
    console.error("randevu-hatirlat list", listError);
    await recordHeartbeat("randevu-hatirlat", "error", `randevu listesi okunamadı: ${listError}`);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
  }

  const windowStart = new Date(startedAt - 20 * 3600_000).toISOString();

  // N+1 KALDIRILDI: randevu başına 1 SELECT + 1 INSERT yerine toplam birkaç sorgu.
  // Tekrar önleme: (1) dedupe_key (migration varsa; anahtar randevu + saat), (2) eski gövde izi `appt:<uuid>`.
  const tenantIds = [...new Set(list.map((a) => String(a.tenant_id)))];
  const keyOf = (a: ApptRow) => buildDedupeKey("appt-hatirlat", a.id, new Date(a.scheduled_at).getTime());
  const [alreadyNotified, alreadyKeys] = await Promise.all([
    findNotifiedIds(admin, {
      href: "/app/randevular",
      tenantIds,
      sinceIso: windowStart,
      markerPrefix: "appt",
    }),
    findNotifiedKeys(admin, { tenantIds, keys: list.map(keyOf) }),
  ]);

  const toInsert: NotificationRow[] = [];
  let skipped = 0;

  for (const a of list) {
    if (alreadyNotified.has(String(a.id).toLowerCase()) || alreadyKeys?.has(keyOf(a))) {
      skipped += 1;
      continue;
    }
    const cust = a.customer;
    const name = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;
    // Teyit linki mesajın gövdesinde: danışman SMS/WhatsApp'a kopyalarken hazır
    // olsun. Kısa tutuluyor (mesaj SMS'e gidebilir); appt:{id} işareti dedupe
    // için SONDA kalmalı (findNotifiedIds markerPrefix bunu okur).
    const teyit = a.confirm_token ? ` · Teyit: ${APP_URL}/randevu-teyit/${a.confirm_token}` : "";
    toInsert.push({
      tenant_id: String(a.tenant_id),
      title: "Yaklaşan randevu",
      body: `${name ?? "Müşteri"} · ${formatDateTimeTr(a.scheduled_at)}${teyit} · appt:${a.id}`,
      href: "/app/randevular",
      kind: "info",
      dedupe_key: keyOf(a),
    });
  }

  const result = await insertNotificationsDetailed(admin, toInsert);
  const notified = result.written;

  const hb = heartbeatFor({
    total: list.length,
    processed: list.length,
    failed: result.failed,
    timedOut: false,
    listError,
    summary: `${notified} hatırlatma, ${skipped + result.duplicates} atlandı`,
  });
  await recordHeartbeat("randevu-hatirlat", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", notified, skipped: skipped + result.duplicates, failed: result.failed });
}
