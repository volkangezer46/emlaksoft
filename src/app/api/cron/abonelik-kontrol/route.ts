import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: trials } = await admin
    .from("subscriptions")
    .select("id, tenant_id, trial_ends_at, status")
    .eq("status", "trialing")
    .lt("trial_ends_at", now)
    .limit(100);

  // N+1 freni: satır başına 3 yazma yerine küme başına 3 toplu yazma.
  // 100 deneme için ~300 gidiş-dönüş → 3'e iner.
  const rows = trials ?? [];
  const subIds = rows.map((s) => s.id);
  const tenantIds = [...new Set(rows.map((s) => s.tenant_id))];

  if (subIds.length > 0) {
    await Promise.all([
      admin.from("subscriptions").update({ status: "past_due", updated_at: now }).in("id", subIds),
      admin.from("tenants").update({ status: "past_due", updated_at: now }).in("id", tenantIds),
      admin.from("notifications").insert(
        tenantIds.map((tenantId) => ({
          tenant_id: tenantId,
          title: "Deneme süresi doldu",
          body: "Aboneliğinizi yenilemek için Paket & ödeme sayfasına gidin.",
          href: "/app/abonelik",
          kind: "warning",
        })),
      ),
    ]);
  }

  const updated = subIds.length;
  await recordHeartbeat("abonelik-kontrol", "ok", `${updated} abonelik güncellendi`);

  return NextResponse.json({ ok: true, updated });
}
