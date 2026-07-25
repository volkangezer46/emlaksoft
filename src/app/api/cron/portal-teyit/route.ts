import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertNotifications, type NotificationRow } from "@/lib/notify-batch";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const due = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: listings } = await admin
    .from("portal_listings")
    .select("id, tenant_id, portal_name, portal_listing_id, last_confirmed_at")
    .eq("status", "live")
    .or(`last_confirmed_at.is.null,last_confirmed_at.lt.${due}`)
    .limit(200);

  // Döngü içi insert yerine toplu yazma: 200 ilan için 200 gidiş-dönüş
  // yerine tek istek (500'lük parçalar hâlinde).
  const rows: NotificationRow[] = (listings ?? []).map((row) => ({
    tenant_id: String(row.tenant_id),
    title: "Portal teyit gecikti",
    body: `${row.portal_name}${row.portal_listing_id ? ` #${row.portal_listing_id}` : ""} — 7+ gündür teyit yok`,
    href: "/app/portallar",
    kind: "warning",
  }));

  const notified = await insertNotifications(admin, rows);

  return NextResponse.json({ ok: true, notified });
}
