import { now } from "@/lib/clock";
import { loadListingControlConfig, type Db } from "./db";
import { consumeControlEvents } from "./events";
import { planVerificationJobs, reapJobs } from "./queue";
import { runControlSweep } from "./sweep";

/**
 * Mevcut cron'lara EKLENEN ilan kontrol adımları (yeni cron YOK; sayı değişmez). Her adım en iyi çabadır: hata mevcut
 * cron işini (havuz atama, portal teyit) BOZMAZ. service_role istemcisi cron GET'inden gelir (zaten kabul listesinde).
 *  - havuz-atama (10 dk): olay tüketimi (tarayıcı işçisi sonuçları), değerlendirme taraması (yayınlanmayan portföy, yetki), lease hasadı, iş planlama.
 *    SLA YÜKSELTME burada DEĞİL: tek SLA zinciri `leak-sla` cron'unda (saatlik; kapanış SLA'sı ile aynı yerde).
 *  - portal-teyit (6 saat): geniş iş planlama + hasat (aynı iş idempotent; açık iş tekil).
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

export async function runControlStepBroad(db: Db): Promise<ControlStepSummary> {
  try {
    const reaped = await reapJobs(db);
    const cache = new Map<string, Awaited<ReturnType<typeof loadListingControlConfig>>>();
    const plan = await planVerificationJobs(
      db,
      async (tenantId) => {
        let c = cache.get(tenantId);
        if (!c) {
          c = await loadListingControlConfig(db, tenantId);
          cache.set(tenantId, c);
        }
        return c;
      },
      now(),
    );
    return { ok: true, text: `${plan.enqueued} kontrol işi planlandı (${plan.tenantsWithClients} cihazlı ofis), ${reaped.requeued} hasat` };
  } catch (err) {
    console.error("runControlStepBroad", err);
    return { ok: false, text: "kontrol planlama başarısız" };
  }
}
