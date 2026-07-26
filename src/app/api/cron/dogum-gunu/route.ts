import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

/**
 * Cron: Bugün doğum günü veya yıldönümü olan müşterileri tespit et,
 * ofis kullanıcılarına bildirim gönder.
 *
 * Zamanlama: Her gün sabah 08:00 (vercel.json'a eklenecek)
 * Yetki: CRON_SECRET header kontrolü
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  // CRON_SECRET tanımlı değilse production'da reddet ("Bearer undefined" bypass'ını engelle)
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured" }, { status: process.env.NODE_ENV === "production" ? 401 : 200 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date();
  const month = today.getMonth() + 1; // 1-12
  const day   = today.getDate();      // 1-31

  // Bugün doğum günü olanlar
  const { data: birthdays } = await admin
    .from("customers")
    .select("id, full_name, tenant_id, birth_date, phone")
    .is("deleted_at", null)
    .not("birth_date", "is", null)
    .filter("birth_date", "not.is", null);

  const todayBirthdays = (birthdays ?? []).filter((c) => {
    if (!c.birth_date) return false;
    const d = new Date(c.birth_date as string);
    return d.getMonth() + 1 === month && d.getDate() === day;
  });

  // Bugün yıldönümü olanlar
  const { data: anniversaries } = await admin
    .from("customers")
    .select("id, full_name, tenant_id, anniversary_date, anniversary_note")
    .is("deleted_at", null)
    .not("anniversary_date", "is", null);

  const todayAnniversaries = (anniversaries ?? []).filter((c) => {
    if (!c.anniversary_date) return false;
    const d = new Date(c.anniversary_date as string);
    return d.getMonth() + 1 === month && d.getDate() === day;
  });

  let notifCount = 0;

  // Tenant bazlı grupla ve bildirim gönder
  const byTenant = new Map<string, { births: typeof todayBirthdays; annivs: typeof todayAnniversaries }>();

  for (const c of todayBirthdays) {
    const tid = c.tenant_id as string;
    if (!byTenant.has(tid)) byTenant.set(tid, { births: [], annivs: [] });
    byTenant.get(tid)!.births.push(c);
  }
  for (const c of todayAnniversaries) {
    const tid = c.tenant_id as string;
    if (!byTenant.has(tid)) byTenant.set(tid, { births: [], annivs: [] });
    byTenant.get(tid)!.annivs.push(c);
  }

  for (const [tenantId, { births, annivs }] of byTenant) {
    const parts: string[] = [];
    if (births.length > 0) {
      parts.push(`🎂 Doğum günü: ${births.map((c) => c.full_name).join(", ")}`);
    }
    if (annivs.length > 0) {
      parts.push(`🎉 Yıldönümü: ${annivs.map((c) => c.full_name + (c.anniversary_note ? ` (${c.anniversary_note})` : "")).join(", ")}`);
    }

    await admin.from("notifications").insert({
      tenant_id: tenantId,
      title:     `Bugün ${births.length + annivs.length} özel gün`,
      body:      parts.join(" · "),
      href:      "/app/musteriler",
      kind:      "info",
    });
    notifCount++;
  }

  await recordHeartbeat("dogum-gunu", "ok", `${notifCount} ofise özel gün bildirimi`);

  return NextResponse.json({
    ok: true,
    birthdays:    todayBirthdays.length,
    anniversaries: todayAnniversaries.length,
    tenants_notified: notifCount,
    date: `${day}/${month}`,
  });
}
