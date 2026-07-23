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
  const to = new Date(Date.now() + 24 * 3600_000);

  // Açık, atanmış ve önümüzdeki 24 saatte (veya geçmişte) vadesi gelen görevler
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, tenant_id, title, due_at, assigned_to")
    .eq("status", "open")
    .not("assigned_to", "is", null)
    .not("due_at", "is", null)
    .lte("due_at", to.toISOString())
    .limit(300);

  let notified = 0;
  let skipped = 0;
  const windowStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const now = Date.now();

  for (const t of tasks ?? []) {
    const marker = `task:${t.id}`;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("tenant_id", t.tenant_id)
      .eq("href", "/app/gorevler")
      .gte("created_at", windowStart)
      .ilike("body", `%${marker}%`)
      .limit(1);

    if (existing?.length) {
      skipped += 1;
      continue;
    }

    const overdue = new Date(t.due_at as string).getTime() < now;
    await admin.from("notifications").insert({
      tenant_id: t.tenant_id,
      user_id: t.assigned_to,
      title: overdue ? "Geciken görev" : "Yaklaşan görev",
      body: `${t.title} · ${new Date(t.due_at as string).toLocaleString("tr-TR")} · ${marker}`,
      href: "/app/gorevler",
      kind: overdue ? "warning" : "info",
    });
    notified += 1;
  }

  return NextResponse.json({ ok: true, notified, skipped });
}
