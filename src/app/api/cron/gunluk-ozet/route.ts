import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function wantsDigest(prefs: unknown) {
  if (!prefs || typeof prefs !== "object") return true;
  const digest = (prefs as { digest?: boolean }).digest;
  return digest !== false;
}

/** Günlük ofis özeti — tercihi açık kullanıcılara */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.toISOString();

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name")
    .in("status", ["active", "trial", "past_due"])
    .limit(500);

  let sent = 0;
  let skippedPrefs = 0;

  for (const t of tenants ?? []) {
    const [{ count: newCustomers }, { count: newDeals }, { count: overduePortals }, { data: profiles }] =
      await Promise.all([
        admin
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id)
          .gte("created_at", since)
          .is("deleted_at", null),
        admin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id)
          .gte("updated_at", since),
        admin
          .from("portal_listings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id)
          .eq("status", "live")
          .or(
            `last_confirmed_at.is.null,last_confirmed_at.lt.${new Date(Date.now() - 7 * 86_400_000).toISOString()}`,
          ),
        admin
          .from("profiles")
          .select("id, notification_prefs")
          .eq("tenant_id", t.id)
          .eq("is_active", true),
      ]);

    const body = `Bugün: ${newCustomers ?? 0} müşteri · ${newDeals ?? 0} anlaşma hareketi · ${overduePortals ?? 0} gecikmiş teyit`;
    const recipients = (profiles ?? []).filter((p) => wantsDigest(p.notification_prefs));
    skippedPrefs += (profiles?.length ?? 0) - recipients.length;
    if (recipients.length === 0) continue;

    // N+1 yerine: bugün özet almış kullanıcıları tek sorguda topla, kalanları tek insert ile ekle
    const { data: alreadySent } = await admin
      .from("notifications")
      .select("user_id")
      .eq("tenant_id", t.id)
      .eq("title", "Günlük ofis özeti")
      .gte("created_at", since);
    const sentSet = new Set((alreadySent ?? []).map((n) => n.user_id));

    const rows = recipients
      .filter((p) => !sentSet.has(p.id))
      .map((p) => ({
        tenant_id: t.id,
        user_id: p.id,
        title: "Günlük ofis özeti",
        body,
        href: "/app/raporlar",
        kind: "info",
      }));

    if (rows.length > 0) {
      const { error } = await admin.from("notifications").insert(rows);
      if (!error) sent += rows.length;
    }
  }

  await recordHeartbeat("gunluk-ozet", "ok", `${sent} özet gönderildi`);

  return NextResponse.json({ ok: true, sent, skippedPrefs });
}
