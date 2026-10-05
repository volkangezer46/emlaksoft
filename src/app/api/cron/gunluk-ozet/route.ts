import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { cronDeadline, fetchAllPaged, heartbeatFor, isPastDeadline, remainingOf } from "@/lib/cron-run";

function wantsDigest(prefs: unknown) {
  if (!prefs || typeof prefs !== "object") return true;
  const digest = (prefs as { digest?: boolean }).digest;
  return digest !== false;
}

/** Günlük ofis özeti — tercihi açık kullanıcılara */
/** Uzun süren toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.toISOString();

  const startedAt = Date.now();
  const deadline = cronDeadline(startedAt);
  // order(id) + range sayfalama (sırasız .limit(500) yok): 500+ ofis sessizce atlanmaz.
  const { rows: tenants, error: tenantsError } = await fetchAllPaged<{ id: string; name: string }>((from, to) =>
    admin
      .from("tenants")
      .select("id, name")
      .in("status", ["active", "trial", "past_due"])
      .order("id", { ascending: true })
      .range(from, to),
  );

  let sent = 0;
  let skippedPrefs = 0;
  let processed = 0;
  let failed = 0;
  let timedOut = false;

  for (const t of tenants) {
    if (isPastDeadline(Date.now(), deadline)) {
      timedOut = true;
      break;
    }
    processed += 1;
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
      if (error) failed += 1;
      else sent += rows.length;
    }
  }

  const hb = heartbeatFor({
    total: tenants.length,
    processed,
    failed,
    timedOut,
    listError: tenantsError,
    summary: `${sent} özet gönderildi`,
  });
  await recordHeartbeat("gunluk-ozet", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", sent, skippedPrefs, failed, remaining: remainingOf({ total: tenants.length, processed }) });
}
