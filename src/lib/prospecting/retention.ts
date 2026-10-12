import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS } from "@/lib/clock";
import { RETENTION_DEFAULT_DAYS, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "./thresholds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** Ofis ayarı 30–180 gün; bozuk/aralık dışı değer varsayılana (90) düşer. */
export function clampRetentionDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return RETENTION_DEFAULT_DAYS;
  const r = Math.round(n);
  return r >= RETENTION_MIN_DAYS && r <= RETENTION_MAX_DAYS ? r : RETENTION_DEFAULT_DAYS;
}

export type PurgeCandidate = {
  id: string;
  status: string;
  lastActivityMs: number;
  piiPurged: boolean;
  isSample?: boolean;
};

/**
 * Kişisel veri silinmeli mi (SAF). Dönüşen kayıt kapsam dışıdır (kişisel veri müşteri kaydına geçti ve müşteri
 * saklama kuralları işler). Son etkinlikten `retentionDays` gün geçtiyse silinir.
 */
export function isPurgeDue(c: PurgeCandidate, retentionDays: number, nowMs: number): boolean {
  if (c.piiPurged || c.status === "portfoye_donustu") return false;
  return nowMs - c.lastActivityMs >= clampRetentionDays(retentionDays) * DAY_MS;
}

/** Silinen alanlar: ad, telefon ve telefon özeti. İlan bağlantısı, fiyat geçmişi, durum ve kayıp nedeni KALIR. */
export const PII_CLEAR_PATCH = { owner_name: null, phone: null, phone_hash: null } as const;

export type PurgeSummary = { purged: number; tenants: number; skipped: boolean };

/**
 * Günlük `operational-retention` cron'unun ayrı adımı (yeni cron YOK). Admin istemci PARAMETRE olarak gelir
 * (yeni createAdminClient kullanımı doğmaz). Ofis başına saklama süresi `retentionFor(tenantId)` ile çözülür.
 * Etkinlik notları da silinir. Tablo yoksa sessizce atlar; idempotent.
 */
export async function purgeExpiredFsboPii(
  admin: AnyClient,
  opts: { nowMs: number; retentionFor: (tenantId: string) => Promise<number>; batch?: number },
): Promise<PurgeSummary> {
  const floorMs = opts.nowMs - RETENTION_MIN_DAYS * DAY_MS;
  const { data, error } = await admin
    .from("fsbo_leads")
    .select("id, tenant_id, status, last_activity_at")
    .is("pii_purged_at", null)
    .neq("status", "portfoye_donustu")
    .lt("last_activity_at", new Date(floorMs).toISOString())
    .limit(opts.batch ?? 500);
  if (error) {
    if (!["42P01", "PGRST205", "42703"].includes(String(error.code))) console.error("purgeExpiredFsboPii", error);
    return { purged: 0, tenants: 0, skipped: true };
  }
  const byTenant = new Map<string, { id: string; status: string; last_activity_at: string }[]>();
  for (const r of (data ?? []) as { id: string; tenant_id: string; status: string; last_activity_at: string }[]) {
    const list = byTenant.get(r.tenant_id) ?? [];
    list.push(r);
    byTenant.set(r.tenant_id, list);
  }
  let purged = 0;
  for (const [tenantId, rows] of byTenant) {
    const days = await opts.retentionFor(tenantId);
    const due = rows
      .filter((r) => isPurgeDue({ id: r.id, status: r.status, lastActivityMs: Date.parse(r.last_activity_at), piiPurged: false }, days, opts.nowMs))
      .map((r) => r.id);
    if (due.length === 0) continue;
    const stamp = new Date(opts.nowMs).toISOString();
    const upd = await admin.from("fsbo_leads").update({ ...PII_CLEAR_PATCH, pii_purged_at: stamp }).eq("tenant_id", tenantId).in("id", due);
    if (upd.error) {
      console.error("purgeExpiredFsboPii update", upd.error);
      continue;
    }
    await admin.from("fsbo_lead_activities").update({ note: null }).eq("tenant_id", tenantId).in("lead_id", due);
    purged += due.length;
  }
  return { purged, tenants: byTenant.size, skipped: false };
}
