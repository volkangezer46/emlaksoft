import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";
import { authorizeCron } from "@/lib/cron-auth";
import { cronDeadline, heartbeatFor, isPastDeadline } from "@/lib/cron-run";
import { insertNotificationsDetailed } from "@/lib/notify-batch";
import { buildDedupeKey } from "@/lib/notify-dedupe";

/** Toplu işlem: varsayılan süre yetmeyebilir (zaman bütçesi 240 sn). */
export const maxDuration = 300;

function leakSeverity(dealAmount: number | null, daysOpen: number): "low" | "medium" | "high" | "critical" {
  const amount = dealAmount ?? 0;
  if (daysOpen >= 30 && amount > 500_000) return "critical";
  if (daysOpen >= 14 && amount > 300_000) return "high";
  if (daysOpen >= 7 && amount > 100_000) return "medium";
  return "low";
}

type ClosureRow = {
  id: string;
  tenant_id: string;
  reason: string;
  deal_amount: number | null;
  estimated_lost_commission: number | null;
  created_at: string;
  portal_listing:
    | { property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }
    | { property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }[]
    | null;
};

/** Proaktif kayıp-kaçak: deal olmadan kapanmış + uyarısı gitmemiş + SLA aşımı → bildir */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const now = Date.now();
  const sla7 = new Date(now - 7 * 86_400_000).toISOString();

  const { data: closures, error } = await admin
    .from("listing_closures")
    .select(
      "id, tenant_id, reason, deal_amount, estimated_lost_commission, created_at, portal_listing:portal_listings!listing_closures_portal_listing_id_fkey(property:properties!portal_listings_property_id_fkey(property_code,title))",
    )
    .is("sla_warning_sent_at", null)
    .not("deal_happened", "is", true)
    .lt("created_at", sla7)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);

  if (error) {
    console.error("leak-sla cron", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  // Modül kapısı: "Kaçan komisyonlar" (ya da bağlı olduğu Portal Kontrol) kapalı ofis için uyarı üretilmez.
  const disabledModules = await getDisabledModulesByTenant(admin);
  let sent = 0;
  let failed = 0;
  let processed = 0;
  let timedOut = false;
  const deadline = cronDeadline(now);
  for (const c of (closures ?? []) as ClosureRow[]) {
    if (isPastDeadline(Date.now(), deadline)) {
      timedOut = true;
      break;
    }
    processed += 1;
    if (isDisabledFor(disabledModules, c.tenant_id, "leak")) continue;
    const daysOpen = Math.floor((now - new Date(c.created_at).getTime()) / 86_400_000);
    const amount = c.estimated_lost_commission != null ? Number(c.estimated_lost_commission) : c.deal_amount != null ? Number(c.deal_amount) : null;
    const severity = leakSeverity(amount, daysOpen);

    const listing = Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
    const prop = listing?.property;
    const property = Array.isArray(prop) ? prop[0] : prop;
    const propCode = property?.property_code ?? "—";
    const title = property?.title ?? "";

    const body = `${propCode}${title ? ` · ${title}` : ""} · ${daysOpen} gün sonuçsuz · ${severity}`;

    // SIRA: önce bildirim, BAŞARILIYSA işaretle. Bildirim yazılamadıysa sla_warning_sent_at yazılmaz (sonraki turda
    // yeniden denenir). dedupe_key kapanış başına tektir: bildirim yazılıp işaretleme düşerse sonraki tur "zaten var"
    // (duplicates) görür, tekrar bildirim üretmeden yalnız işaretler.
    const ins = await insertNotificationsDetailed(admin, [
      {
        tenant_id: c.tenant_id,
        title: "Kayıp-kaçak SLA uyarısı",
        body,
        href: "/app/kayip-kacak",
        kind: severity === "critical" ? "danger" : severity === "high" ? "warning" : "info",
        dedupe_key: buildDedupeKey("leak-sla", c.id),
      },
    ]);
    if (ins.failed > 0 || ins.written + ins.duplicates === 0) {
      failed += 1;
      continue;
    }

    const { error: markError } = await admin
      .from("listing_closures")
      .update({ sla_warning_sent_at: new Date().toISOString(), leak_severity: severity })
      .eq("id", c.id);
    if (markError) {
      console.error("leak-sla işaretleme", markError.message);
      failed += 1;
      continue;
    }

    sent += 1;
  }

  const hb = heartbeatFor({
    total: (closures ?? []).length,
    processed: processed,
    failed,
    timedOut,
    summary: `${sent} SLA uyarısı${skippedTenantsNote(disabledModules, "leak")}`,
  });
  await recordHeartbeat("leak-sla", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", sent, failed });
}
