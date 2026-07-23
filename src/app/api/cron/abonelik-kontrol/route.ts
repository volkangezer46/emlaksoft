import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  let updated = 0;
  for (const s of trials ?? []) {
    await admin.from("subscriptions").update({ status: "past_due", updated_at: now }).eq("id", s.id);
    await admin.from("tenants").update({ status: "past_due", updated_at: now }).eq("id", s.tenant_id);
    await admin.from("notifications").insert({
      tenant_id: s.tenant_id,
      title: "Deneme süresi doldu",
      body: "Aboneliğinizi yenilemek için Paket & ödeme sayfasına gidin.",
      href: "/app/abonelik",
      kind: "warning",
    });
    updated += 1;
  }

  return NextResponse.json({ ok: true, updated });
}
