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
  const from = new Date();
  const to = new Date(Date.now() + 24 * 86_400_000);
  const { data: appts } = await admin
    .from("appointments")
    .select("id, tenant_id, appointment_type, scheduled_at, customer:customers(full_name)")
    .gte("scheduled_at", from.toISOString())
    .lte("scheduled_at", to.toISOString())
    .neq("status", "cancelled")
    .limit(200);

  let notified = 0;
  let skipped = 0;
  const windowStart = new Date(Date.now() - 20 * 3600_000).toISOString();

  for (const a of appts ?? []) {
    const marker = `appt:${a.id}`;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("tenant_id", a.tenant_id)
      .eq("href", "/app/randevular")
      .gte("created_at", windowStart)
      .ilike("body", `%${marker}%`)
      .limit(1);

    if (existing?.length) {
      skipped += 1;
      continue;
    }

    const cust = a.customer as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;
    await admin.from("notifications").insert({
      tenant_id: a.tenant_id,
      title: "Yaklaşan randevu",
      body: `${name ?? "Müşteri"} · ${new Date(a.scheduled_at).toLocaleString("tr-TR")} · ${marker}`,
      href: "/app/randevular",
      kind: "info",
    });
    notified += 1;
  }

  return NextResponse.json({ ok: true, notified, skipped });
}
