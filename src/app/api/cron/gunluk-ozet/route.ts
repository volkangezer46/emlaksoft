import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { officeDigestDefault, wantsDigest } from "@/lib/digest-prefs";
import { runControlReportDelivery } from "@/lib/listing-control/server/report-delivery";
import { getDisabledModulesByTenant, isDisabledFor, tenantsDisabledFor } from "@/lib/modules/state";
import { runLeagueDailyForTenant } from "@/lib/league/daily";
import { runLicenseSetupTasks } from "@/lib/eids/license-setup";
import { deliverDueReportSubscriptions } from "@/lib/report-center/delivery-run";
import { cronDeadline, fetchAllPaged, heartbeatFor, isPastDeadline, remainingOf, guardCron } from "@/lib/cron-run";
import { now, trDayStartIso } from "@/lib/clock";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";


/** Günlük ofis özeti — tercihi açık kullanıcılara */
/** Uzun süren toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;
/**
 * DG4 rapor abonelikleri adımı cron'un sonundadır; ofis/lig döngüleri bütçeyi bitirse de teslim aç kalmasın diye son
 * 60 sn yalnız ona ayrılır (ofis döngüleri `loopDeadline`'da durur, abonelik adımı tam `deadline`'a kadar çalışır).
 */
const REPORT_SUBS_RESERVE_MS = 60_000;

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("gunluk-ozet", req);
  if (pausedRun) return pausedRun;

  const admin = createAdminClient();
  // Bugünün Türkiye gece yarısı (B076): sunucunun yerel saati (`setHours(0)`) UTC konteynerde TR 03:00'ü verir,
  // gece 00:00–03:00 arası işler "bugün" sayılmazdı. TZ ortamından bağımsız.
  const since = trDayStartIso(now());

  const startedAt = Date.now();
  const deadline = cronDeadline(startedAt);
  const loopDeadline = deadline - REPORT_SUBS_RESERVE_MS;
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
    if (isPastDeadline(Date.now(), loopDeadline)) {
      timedOut = true;
      break;
    }
    processed += 1;
    // Ofis tanımı: kendi tercihini kaydetmemiş kullanıcılar için özet varsayılanı (okunamazsa açık).
    const officeDigest = await officeDigestDefault(admin, t.id);
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
    const recipients = (profiles ?? []).filter((p) => wantsDigest(p.notification_prefs, officeDigest));
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

  // İlan Kontrol raporu teslimi (ofis ayarı açık ofisler; en iyi çaba, özet işini bozmaz; dedupe dönem başına tek).
  let controlReports = 0;
  try {
    const lc = await runControlReportDelivery(admin, "daily", Date.now(), {
      disabledTenantIds: new Set(tenantsDisabledFor(await getDisabledModulesByTenant(admin), "portals")),
    });
    controlReports = lc.sent;
    failed += lc.failed;
  } catch (e) {
    log.error("cron_gunluk_ozet_ilan_kontrol_failed", { route: "/api/cron/gunluk-ozet", ...errorFields(e) });
  }

  // Lig 2.0: biten meydan okumaları mühürle + yeni rozetleri ofise duyur (en iyi çaba; özet işini bozmaz).
  let leagueFinished = 0;
  let leagueBadges = 0;
  try {
    const leagueDisabled = await getDisabledModulesByTenant(admin);
    for (const t of tenants) {
      if (isPastDeadline(Date.now(), loopDeadline)) break;
      if (isDisabledFor(leagueDisabled, t.id, "team_perf")) continue;
      const r = await runLeagueDailyForTenant(admin, t.id, Date.now());
      leagueFinished += r.finishedChallenges;
      leagueBadges += r.badgesWritten;
      failed += r.failed;
    }
  } catch (e) {
    log.error("cron_gunluk_ozet_lig_failed", { route: "/api/cron/gunluk-ozet", ...errorFields(e) });
  }

  // EİDS (EP5): yetki belgesi no boş ofislerde sahibine tek seferlik kurulum görevi; numara girilmişse açık görev kapanır (ayrık adım).
  let licenseTasks = 0;
  let licenseTasksClosed = 0;
  try {
    const r = await runLicenseSetupTasks(admin, tenants.map((t) => t.id), Date.now());
    licenseTasks = r.opened;
    licenseTasksClosed = r.closed;
    failed += r.failed;
  } catch (e) {
    log.error("cron_gunluk_ozet_yetki_belgesi_failed", { route: "/api/cron/gunluk-ozet", ...errorFields(e) });
    failed += 1;
  }

  // DG4: zamanlanmış rapor abonelikleri (ofis + admin; günlük/haftalık/aylık e-posta eki). Ayrık adım: tablo yoksa
  // atlanır, hata özet işini bozmaz; kanal kapalıysa AD7 günlüğüne "kanal kapalı" düşer.
  let reportSubs = 0;
  let reportSubsChannelOff = 0;
  let reportSubsSkippedRecipients = 0;
  let reportSubsRemaining = 0;
  try {
    const r = await deliverDueReportSubscriptions(admin, Date.now(), {
      disabledModules: await getDisabledModulesByTenant(admin),
      shouldStop: () => isPastDeadline(Date.now(), deadline),
    });
    reportSubs = r.sent;
    reportSubsChannelOff = r.channelDisabled;
    reportSubsSkippedRecipients = r.skippedRecipients;
    reportSubsRemaining = r.remaining;
    // Yalnız gerçek gönderim/üretim hatası; yetkisiz/onaylı/adressiz alıcı atlaması hata sayılmaz.
    failed += r.failed;
  } catch (e) {
    log.error("cron_gunluk_ozet_report_subscriptions_failed", { route: "/api/cron/gunluk-ozet", ...errorFields(e) });
    failed += 1;
  }

  const hb = heartbeatFor({
    total: tenants.length,
    processed,
    failed,
    // Ertesi tura kalan zamanı gelmiş abonelik de "iş kaldı" demektir (heartbeat 'error' + detayda sayı).
    timedOut: timedOut || reportSubsRemaining > 0,
    listError: tenantsError,
    summary: `${sent} özet gönderildi, ${controlReports} ilan kontrol raporu, ${leagueFinished} meydan okuma, ${leagueBadges} rozet, ${licenseTasks} yetki belgesi görevi (${licenseTasksClosed} kapandı), ${reportSubs} rapor aboneliği (${reportSubsChannelOff} kanal kapalı, ${reportSubsSkippedRecipients} alıcı atlandı${reportSubsRemaining > 0 ? `, ${reportSubsRemaining} abonelik ertesi tura kaldı` : ""})`,
  });
  await recordHeartbeat("gunluk-ozet", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", sent, skippedPrefs, failed, remaining: remainingOf({ total: tenants.length, processed }), reportSubscriptionsRemaining: reportSubsRemaining });
}

export const GET = guardCron("gunluk-ozet", run);
