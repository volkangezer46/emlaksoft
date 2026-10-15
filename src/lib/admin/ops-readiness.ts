import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { emailChannelStatus } from "@/lib/email/provider";
import { BACKUP_STATUS_KEY, evaluateBackup } from "@/lib/ops/backup-status";
import { RESTORE_DRILL_STATUS_KEY } from "@/lib/ops/backup-settings";
import { evaluateDrill } from "@/lib/ops/restore-drill-status";
import { INTEGRATIONS_HREF } from "@/lib/admin/integration-hub/model";
import { readinessSignals, type OpsReadiness, type ReadinessSignal } from "./ops-readiness-model";

export type { OpsReadiness, ReadinessSignal } from "./ops-readiness-model";
export { readinessSignals } from "./ops-readiness-model";

/**
 * OPERASYON HAZIRLIK SİNYALLERİ (B114 / B115 / B117): uyarılar bir yere gidiyor mu, yedek güvende mi, e-posta açık mı?
 * Kaynaklar (hepsi service_role, tek turda paralel; okunamayan alan null kalır ve sinyal ÜRETMEZ, sahte uyarı yok):
 *  - etkin uyarı kanalı sayısı (alert_channels.enabled)
 *  - son 24 saatte açılan KRİTİK uyarılardan hiçbir kanala iletilmemiş olanlar (alert_events.deliveries)
 *  - gece yedeği `ops.backup.last` (şifre / uzak kopya / yaş) ve geri yükleme tatbikatı `ops.restore_drill.last`
 *  - e-posta kanalı (Resend anahtarı + gönderen)
 * Sinyaller üst çubuk sistem çipini "uyarı" yapar (`systemStatusOf`) ve Kontrol paneli > Dikkat kuyruğuna satır ekler
 * (`buildAttentionQueue`). 60 sn önbellek (`admin-ops-readiness` etiketi); hesap SAF modelde (`ops-readiness-model.ts`).
 */
export const OPS_READINESS_TAG = "admin-ops-readiness";

type DeliveryRow = { ok?: unknown };

async function loadRaw(): Promise<OpsReadiness> {
  const admin = createAdminClient();
  const nowMs = now();
  const since = new Date(nowMs - 24 * 3_600_000).toISOString();
  const [channelsRes, criticalRes, settingsRes, email] = await Promise.all([
    admin.from("alert_channels").select("id", { count: "exact", head: true }).eq("enabled", true),
    admin.from("alert_events").select("id, deliveries").eq("severity", "critical").gte("first_at", since).order("first_at", { ascending: false }).limit(50),
    admin.from("platform_settings").select("key, value").in("key", [BACKUP_STATUS_KEY, RESTORE_DRILL_STATUS_KEY]),
    emailChannelStatus().catch(() => null),
  ]);
  if (channelsRes.error) console.error("ops-readiness alert_channels", channelsRes.error.code);
  if (criticalRes.error) console.error("ops-readiness alert_events", criticalRes.error.code);
  if (settingsRes.error) console.error("ops-readiness platform_settings", settingsRes.error.code);

  const setting = (key: string) =>
    settingsRes.error ? undefined : (((settingsRes.data ?? []) as { key: string; value: string | null }[]).find((r) => r.key === key)?.value ?? null);
  const backupRaw = setting(BACKUP_STATUS_KEY);
  const drillRaw = setting(RESTORE_DRILL_STATUS_KEY);
  const backup = backupRaw === undefined ? null : evaluateBackup(backupRaw, nowMs);
  const drill = drillRaw === undefined ? null : evaluateDrill(drillRaw, nowMs);

  const critical = criticalRes.error ? null : ((criticalRes.data ?? []) as { id: string; deliveries: DeliveryRow[] | null }[]);
  return {
    channels: channelsRes.error ? null : (channelsRes.count ?? 0),
    criticalLast24h: critical ? critical.length : null,
    unnotifiedCritical24h: critical ? critical.filter((e) => !(Array.isArray(e.deliveries) && e.deliveries.some((d) => d?.ok === true))).length : null,
    backup: backup
      ? backup.record
        ? { present: true, encrypted: backup.record.encrypted, remote: backup.record.remote, ageHours: backup.ageHours }
        : { present: false, encrypted: null, remote: null, ageHours: null }
      : null,
    drill: drill ? { present: drill.record !== null, ok: drill.record?.ok ?? null, ageDays: drill.ageDays } : null,
    emailEnabled: email ? email.enabled : null,
    emailHref: `${INTEGRATIONS_HREF}#entegrasyon-resend`,
  };
}

const cachedReadiness = unstable_cache(loadRaw, ["admin-ops-readiness-v1"], { revalidate: 60, tags: [OPS_READINESS_TAG] });

/** Ham hazırlık verisi (okunamazsa tüm alanlar null; asla fırlatmaz). */
export async function getOpsReadiness(): Promise<OpsReadiness | null> {
  try {
    return await cachedReadiness();
  } catch (e) {
    console.error("ops-readiness", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Çip ve Dikkat kuyruğu için sıralı sinyaller. */
export async function getOpsReadinessSignals(): Promise<ReadinessSignal[]> {
  const r = await getOpsReadiness();
  return r ? readinessSignals(r) : [];
}
