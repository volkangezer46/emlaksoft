import { now } from "@/lib/clock";
import { loadListingControlConfig, type Db } from "./db";
import { consumeControlEvents } from "./events";
import { planVerificationJobs, reapJobs } from "./queue";
import { runControlSweep } from "./sweep";
import { runDuplicateScan } from "./duplicates";
import { runDailyMatch } from "./daily-match";

/**
 * Mevcut cron'lara EKLENEN ilan kontrol adımları (yeni cron YOK; sayı değişmez). Her adım en iyi çabadır: hata mevcut
 * cron işini (havuz atama, portal teyit) BOZMAZ. service_role istemcisi cron GET'inden gelir (zaten kabul listesinde).
 *  - havuz-atama (10 dk): olay tüketimi (tarayıcı işçisi sonuçları), değerlendirme taraması (yayınlanmayan portföy, yetki), lease hasadı, iş planlama.
 *    SLA YÜKSELTME burada DEĞİL: tek SLA zinciri `leak-sla` cron'unda (saatlik; kapanış SLA'sı ile aynı yerde).
 *  - portal-teyit (6 saat): geniş iş planlama + hasat (aynı iş idempotent; açık iş tekil) + GÜNLÜK kopya portföy
 *    taraması + GÜNLÜK EŞLEŞTİRME (eklenti envanteri ↔ portföy; aynı gece turu; `server/duplicates.ts`, `server/daily-match.ts`).
 */

export type ControlStepSummary = { text: string; ok: boolean };

export async function runControlStepFrequent(db: Db, disabledTenantIds: ReadonlySet<string>): Promise<ControlStepSummary> {
  const startedAt = now();
  const cache = new Map<string, Awaited<ReturnType<typeof loadListingControlConfig>>>();
  const loadCfg = async (tenantId: string) => {
    let c = cache.get(tenantId);
    if (!c) {
      c = await loadListingControlConfig(db, tenantId);
      cache.set(tenantId, c);
    }
    return c;
  };
  try {
    const reaped = await reapJobs(db);
    const events = await consumeControlEvents(db, now(), loadCfg, disabledTenantIds);
    const sweep = await runControlSweep(db, startedAt, { limit: 300, deadlineMs: startedAt + 120_000, disabledTenantIds });
    if (sweep.schemaMissing) return { ok: true, text: "ilan kontrol: şema yok (atlandı)" };
    const plan = await planVerificationJobs(db, loadCfg, now());
    return {
      ok: true,
      text: `ilan kontrol: ${events.taken} olay, ${sweep.examined} portföy, ${sweep.anomaliesOpened}+${sweep.anomaliesReopened} anomali açıldı, ${sweep.anomaliesClosed} kapandı, ${plan.enqueued} iş, ${reaped.requeued}/${reaped.failed} hasat`,
    };
  } catch (err) {
    console.error("runControlStepFrequent", err);
    return { ok: false, text: "ilan kontrol adımı başarısız" };
  }
}

/** Kopya portföy taraması günde BİR kez: `portal-teyit` (6 saatte bir) yalnız gece turunda (UTC 00-06) tarar. */
export function isDailyDuplicateWindow(nowMs: number): boolean {
  return new Date(nowMs).getUTCHours() < 6;
}

export async function runControlStepBroad(db: Db, opts: { disabledTenantIds?: ReadonlySet<string> } = {}): Promise<ControlStepSummary> {
  try {
    const startedAt = now();
    const reaped = await reapJobs(db);
    const cache = new Map<string, Awaited<ReturnType<typeof loadListingControlConfig>>>();
    const cfgFor = async (tenantId: string) => {
      let c = cache.get(tenantId);
      if (!c) {
        c = await loadListingControlConfig(db, tenantId);
        cache.set(tenantId, c);
      }
      return c;
    };
    const plan = await planVerificationJobs(db, cfgFor, now());
    let dupText = "";
    if (isDailyDuplicateWindow(startedAt)) {
      const dup = await runDuplicateScan(db, {
        deadlineMs: startedAt + 150_000,
        cfgFor,
        disabledTenantIds: opts.disabledTenantIds,
        rotateSeed: Math.floor(startedAt / 86_400_000),
      });
      dupText = dup.schemaMissing
        ? " · kopya taraması: şema yok"
        : ` · kopya taraması: ${dup.tenants} ofis, ${dup.pairs} çift, ${dup.opened} açıldı, ${dup.closed} kapandı${dup.timedOut ? " (süre doldu, kalan yarın)" : ""}`;
    }
    // Günlük eşleştirme (eklentinin yüklediği envanter ↔ güncel portföy): kopya taramasıyla aynı gece penceresi, ayrı zaman bütçesi.
    if (isDailyDuplicateWindow(startedAt)) {
      try {
        const dm = await runDailyMatch(db, {
          deadlineMs: Math.min(now() + 60_000, startedAt + 240_000),
          disabledTenantIds: opts.disabledTenantIds,
          rotateSeed: Math.floor(startedAt / 86_400_000),
        });
        dupText += dm.schemaMissing
          ? " · günlük eşleştirme: şema yok"
          : ` · günlük eşleştirme: ${dm.tenants} ofis, ${dm.candidates} aday, ${dm.linked} bağlandı, ${dm.closed} kapandı, ${dm.reranked} güncellendi, ${dm.anomaliesOpened} uyarı${dm.timedOut ? " (süre doldu, kalan yarın)" : ""}`;
      } catch (err) {
        console.error("runDailyMatch", err);
        dupText += " · günlük eşleştirme başarısız";
      }
    }
    return { ok: true, text: `${plan.enqueued} kontrol işi planlandı (${plan.tenantsWithClients} cihazlı ofis), ${reaped.requeued} hasat${dupText}` };
  } catch (err) {
    console.error("runControlStepBroad", err);
    return { ok: false, text: "kontrol planlama başarısız" };
  }
}
