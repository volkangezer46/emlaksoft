import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, now } from "@/lib/clock";
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

export type PurgeSummary = {
  purged: number;
  /** Süresi dolmuş aday kaydı olan ve gezilen ofis sayısı. */
  tenants: number;
  skipped: boolean;
  /** Süre/satır tavanı yüzünden bu turda işlenemeyen, süresi dolmuş kayıt sayısı (tavana takılmadıysa 0). */
  expiredRemaining: number;
  /** Tavan aşıldığı için tur yarıda kesildi (kalanı sonraki turda işlenir). */
  truncated: boolean;
};

export const PURGE_DEFAULT_BUDGET_MS = 60_000;
export const PURGE_DEFAULT_MAX_ROWS = 5000;
const MISSING_CODES = ["42P01", "PGRST205", "42703"];

/**
 * Günlük `operational-retention` cron'unun ayrı adımı (yeni cron YOK). Admin istemci PARAMETRE olarak gelir
 * (yeni createAdminClient kullanımı doğmaz). Ofis başına saklama süresi `retentionFor(tenantId)` ile çözülür.
 * Etkinlik notları da silinir. Tablo yoksa sessizce atlar; idempotent.
 *
 * Ofisler `tenant_id` sırasıyla tek tek gezilir (her ofis kendi kesim tarihiyle, son etkinliğe göre eskiden yeniye partiler):
 * 180 günlük bir ofisin henüz süresi dolmamış kayıtları 90 günlük bir ofisin süresi dolmuş kayıtlarını engellemez.
 * Toplam süre (`budgetMs`, varsayılan 60 sn) ve satır (`maxRows`, varsayılan 5000) tavanı vardır; aşılırsa tur kesilir,
 * `expiredRemaining` kalanı bildirir (heartbeat detayına yazılır).
 */
export async function purgeExpiredFsboPii(
  admin: AnyClient,
  opts: {
    nowMs: number;
    retentionFor: (tenantId: string) => Promise<number>;
    batch?: number;
    budgetMs?: number;
    maxRows?: number;
    /** Süre ölçümü (test için); varsayılan `now()`. */
    clock?: () => number;
  },
): Promise<PurgeSummary> {
  const batch = opts.batch ?? 500;
  const budgetMs = opts.budgetMs ?? PURGE_DEFAULT_BUDGET_MS;
  const maxRows = opts.maxRows ?? PURGE_DEFAULT_MAX_ROWS;
  const clock = opts.clock ?? now;
  const startedAt = clock();
  const floorIso = new Date(opts.nowMs - RETENTION_MIN_DAYS * DAY_MS).toISOString();
  const stamp = new Date(opts.nowMs).toISOString();

  const summary: PurgeSummary = { purged: 0, tenants: 0, skipped: false, expiredRemaining: 0, truncated: false };
  const overBudget = () => clock() - startedAt >= budgetMs || summary.purged >= maxRows;

  const reportError = (label: string, error: { code?: string } | null): boolean => {
    if (!error) return false;
    if (!MISSING_CODES.includes(String(error.code))) console.error(label, error);
    return true;
  };

  // Aday ofisler: distinct yerine `tenant_id` imleciyle sırayla (her adım tek satır).
  let lastTenant: string | null = null;
  for (;;) {
    let q = admin
      .from("fsbo_leads")
      .select("tenant_id")
      .is("pii_purged_at", null)
      .neq("status", "portfoye_donustu")
      .lt("last_activity_at", floorIso);
    if (lastTenant) q = q.gt("tenant_id", lastTenant);
    const { data, error } = await q.order("tenant_id", { ascending: true }).limit(1);
    if (error) {
      reportError("purgeExpiredFsboPii", error);
      summary.skipped = lastTenant === null;
      return summary;
    }
    const tenantId = ((data ?? []) as { tenant_id: string }[])[0]?.tenant_id;
    if (!tenantId) break;
    lastTenant = tenantId;

    const days = await opts.retentionFor(tenantId);
    const cutoffIso = new Date(opts.nowMs - clampRetentionDays(days) * DAY_MS).toISOString();
    const due = () =>
      admin.from("fsbo_leads").select("id")
        .eq("tenant_id", tenantId)
        .is("pii_purged_at", null)
        .neq("status", "portfoye_donustu")
        .lt("last_activity_at", cutoffIso);
    summary.tenants += 1;

    let drained = false;
    while (!overBudget()) {
      const { data: rows, error: selErr } = await due().order("last_activity_at", { ascending: true }).limit(batch);
      if (reportError("purgeExpiredFsboPii select", selErr)) {
        drained = true; // bu ofiste ilerlenemez; sonsuz döngüye girme
        break;
      }
      const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);
      if (ids.length === 0) {
        drained = true;
        break;
      }
      const upd = await admin.from("fsbo_leads").update({ ...PII_CLEAR_PATCH, pii_purged_at: stamp }).eq("tenant_id", tenantId).in("id", ids);
      if (upd.error) {
        console.error("purgeExpiredFsboPii update", upd.error);
        drained = true;
        break;
      }
      await admin.from("fsbo_lead_activities").update({ note: null }).eq("tenant_id", tenantId).in("lead_id", ids);
      summary.purged += ids.length;
      if (ids.length < batch) {
        drained = true;
        break;
      }
    }

    if (!drained) {
      // Tavan bu ofisin ortasında ya da öncesinde aşıldı: kalanı say (kesim tarihine göre).
      const { count, error: cntErr } = await admin
        .from("fsbo_leads")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("pii_purged_at", null)
        .neq("status", "portfoye_donustu")
        .lt("last_activity_at", cutoffIso);
      if (cntErr) summary.truncated = true;
      else if ((count ?? 0) > 0) {
        summary.truncated = true;
        summary.expiredRemaining += count ?? 0;
      }
    }
  }
  return summary;
}
