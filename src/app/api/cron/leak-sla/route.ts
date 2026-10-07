import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote, tenantsDisabledFor } from "@/lib/modules/state";
import { authorizeCron } from "@/lib/cron-auth";
import { cronDeadline, heartbeatFor, isPastDeadline } from "@/lib/cron-run";
import { insertNotificationsDetailed } from "@/lib/notify-batch";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { leakSeverity } from "@/lib/listing-control/sla-plan";
import { loadListingControlConfig } from "@/lib/listing-control/server/db";
import { runSlaEscalation } from "@/lib/listing-control/server/escalate";
import type { ListingControlConfig } from "@/lib/listing-control/config";

/** Toplu işlem: varsayılan süre yetmeyebilir (zaman bütçesi 240 sn). */
export const maxDuration = 300;

type PropertyEmbed = { id?: string; property_code?: string; title?: string | null };
type ClosureRow = {
  id: string;
  tenant_id: string;
  reason: string;
  deal_amount: number | null;
  estimated_lost_commission: number | null;
  created_at: string;
  portal_listing:
    | { property: PropertyEmbed | PropertyEmbed[] | null }
    | { property: PropertyEmbed | PropertyEmbed[] | null }[]
    | null;
};

function propertyOf(c: ClosureRow): PropertyEmbed | undefined {
  const listing = Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
  const prop = listing?.property;
  return Array.isArray(prop) ? prop[0] : (prop ?? undefined);
}

/** Açık `potential_lost_deal` anomalisi olan portföy kimlikleri. Tablo yoksa/hata olursa boş küme (eski davranış). */
async function propertiesWithOpenLostDealAnomaly(admin: ReturnType<typeof createAdminClient>, propertyIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(propertyIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("listing_anomalies")
      .select("property_id")
      .eq("type", "potential_lost_deal")
      .in("status", ["open", "acknowledged"])
      .in("property_id", ids.slice(i, i + 200));
    if (error) return new Set<string>();
    for (const r of (data ?? []) as { property_id: string }[]) out.add(r.property_id);
  }
  return out;
}

/**
 * Proaktif kayıp-kaçak: deal olmadan kapanmış + uyarısı gitmemiş + SLA aşımı → bildir ("sonuçsuz kapanış" takibi).
 * "Potansiyel kayıp" TUTARI tek kaynaktır: listing_anomalies (`closure_loss` kapanış tetikleyicisiyle, `potential_lost_deal`
 * motorla; 20261007000610). Kayıplı kapanış (deal_happened=true) bu döngüye zaten girmez; açık `potential_lost_deal`
 * uyarısı olan portföy için de bu cron ek bildirim üretmez (aşağıdaki `covered`).
 * TEK SLA ZİNCİRİ: aynı çalıştırmada İlan Kontrol anomalilerinin yükseltmesi de yürür (danışman 0-4 saat → takım lideri
 * → 8. saat şube müdürü → 24. saat ofis sahibi; süreler ofis ayarlı). Yeni cron YOK: bu cron saatlik çalışır ki 4/8/24
 * saatlik kademeler en çok ~1 saat gecikmeyle tetiklensin. Aşama kaydı (anomali, aşama) tekildir; tekrar çalışma
 * aynı aşamayı iki kez bildirmez.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const now = Date.now();
  const sla7 = new Date(now - 7 * 86_400_000).toISOString();

  // İlan Kontrol SLA yükseltmesi (en iyi çaba; hata kapanış SLA işini bozmaz).
  let escalated = 0;
  let escalationTasks = 0;
  let escalationFailed = false;
  try {
    const disabledForControl = new Set(tenantsDisabledFor(await getDisabledModulesByTenant(admin), "portals"));
    const cfgCache = new Map<string, ListingControlConfig>();
    const esc = await runSlaEscalation(admin, now, {
      disabledTenantIds: disabledForControl,
      cfgFor: async (tenantId) => {
        let c = cfgCache.get(tenantId);
        if (!c) {
          c = await loadListingControlConfig(admin, tenantId);
          cfgCache.set(tenantId, c);
        }
        return c;
      },
    });
    escalated = esc.escalated;
    escalationTasks = esc.tasksCreated;
  } catch (e) {
    escalationFailed = true;
    console.error("leak-sla anomali SLA yükseltme", e);
  }

  const { data: closures, error } = await admin
    .from("listing_closures")
    .select(
      "id, tenant_id, reason, deal_amount, estimated_lost_commission, created_at, portal_listing:portal_listings!listing_closures_portal_listing_id_fkey(property:properties!portal_listings_property_id_fkey(id,property_code,title))",
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
  // Çoğaltma yok: aynı portföy için ilan kontrol sisteminde AÇIK "potansiyel kayıp işlem" anomalisi varsa (kendi SLA
  // zinciri bildirim yapıyor) bu cron ek "SLA uyarısı" üretmez; yalnız işaretler. Tablo yoksa eski davranış.
  const covered = await propertiesWithOpenLostDealAnomaly(
    admin,
    ((closures ?? []) as ClosureRow[]).map((c) => propertyOf(c)?.id).filter((x): x is string => !!x),
  );
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

    const property = propertyOf(c);
    const propCode = property?.property_code ?? "—";
    const title = property?.title ?? "";

    if (property?.id && covered.has(property.id)) {
      const { error: coveredMarkError } = await admin
        .from("listing_closures")
        .update({ sla_warning_sent_at: new Date().toISOString(), leak_severity: severity })
        .eq("id", c.id);
      if (coveredMarkError) failed += 1;
      continue;
    }

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
    failed: failed + (escalationFailed ? 1 : 0),
    timedOut,
    summary: `${sent} SLA uyarısı · ${escalated} anomali SLA aşaması · ${escalationTasks} danışman görevi${skippedTenantsNote(disabledModules, "leak")}`,
  });
  await recordHeartbeat("leak-sla", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", sent, failed });
}
