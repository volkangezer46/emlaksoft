import type { ListingControlConfig } from "../config";
import { chunk, isMissingSchema, type Db } from "./db";
import { syncProperties } from "./sync";

/**
 * OLAY TÜKETİCİSİ (cron adımı, yeni cron YOK). `listing_control_events` kontrol durumu değişimi ve anomali olaylarını
 * tetikleyicilerle yazar (migration 20260826002800). Burada: durum değişen portföyler HEMEN motorla eşitlenir (anomali
 * aç/kapat, KPI bayrakları) ve olaylar `processed_at` ile kapatılır; böylece tarayıcı işçisinin sonucu (kullanıcı JWT'si
 * `lc_mark_state_stale` ile yalnız "bayat" işaretler) tarama turunu beklemez. Aynı portföy tur içinde bir kez eşitlenir.
 * `listing_confirmed` olayları `last_confirmed_at`'i ilerletir (doğrulama ↔ Kalkan teyit tazeliği tek kaynak).
 * `counters_changed` olayları yalnız Realtime içindir; işlenmiş işaretlenir, eşitleme gerektirmez.
 * Saklama: işlenmiş olay 14 gün, işlenmemiş 30 gün sonra silinir. service_role istemcisi ÇAĞIRAN verir.
 */

export type EventRow = { id: string; tenant_id: string; property_id: string | null; portal_listing_id?: string | null; event_type: string; created_at?: string };

/** Portföyü HEMEN yeniden değerlendirten olaylar. `closure_recorded`: Kalkan kapanış formu girildi → anomali kendiliğinden kapanır. */
const SYNC_EVENTS: ReadonlySet<string> = new Set(["check_state_changed", "anomaly_status_changed", "closure_recorded"]);

/** Eşitleme gerektiren olaylardan ofis -> tekil portföy kümesi (SAF). */
export function propertiesToSync(rows: readonly EventRow[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.property_id) continue;
    if (!SYNC_EVENTS.has(r.event_type)) continue;
    const set = out.get(r.tenant_id) ?? new Set<string>();
    set.add(r.property_id);
    out.set(r.tenant_id, set);
  }
  return new Map([...out].map(([t, s]) => [t, [...s]]));
}

export type EventSummary = { taken: number; synced: number; confirmed: number; purged: number; schemaMissing: boolean };

const TAKE_LIMIT = 300;
const PROCESSED_KEEP_DAYS = 14;
const UNPROCESSED_KEEP_DAYS = 30;

export async function consumeControlEvents(
  db: Db,
  nowMs: number,
  cfgFor: (tenantId: string) => Promise<ListingControlConfig>,
  disabledTenantIds: ReadonlySet<string> = new Set(),
): Promise<EventSummary> {
  const out: EventSummary = { taken: 0, synced: 0, confirmed: 0, purged: 0, schemaMissing: false };
  const { data, error } = await db
    .from("listing_control_events")
    .select("id, tenant_id, property_id, portal_listing_id, event_type, created_at")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(TAKE_LIMIT);
  if (error) {
    out.schemaMissing = isMissingSchema(error);
    if (!out.schemaMissing) console.error("consumeControlEvents list", { code: error.code });
    return out;
  }
  const rows = ((data ?? []) as EventRow[]).filter((r) => !disabledTenantIds.has(r.tenant_id));
  out.taken = rows.length;

  for (const [tenantId, ids] of propertiesToSync(rows)) {
    const cfg = await cfgFor(tenantId);
    for (const part of chunk(ids, 100)) {
      const r = await syncProperties(db, tenantId, part, cfg, nowMs);
      out.synced += r.examined;
      if (r.schemaMissing) out.schemaMissing = true;
    }
  }

  // Teyit tazeliği TEK kaynak: doğrulama 'yayında' dediyse portal_listings.last_confirmed_at (Kalkan, Portal Kontrol, ana
  // ekran teyit gecikmesi bunu okur) olay zamanına ilerler. Yalnız ileri doğru (daha yeni zaman kazanır).
  for (const r of rows) {
    if (r.event_type !== "listing_confirmed" || !r.portal_listing_id || !r.created_at) continue;
    const { data: upd, error: upErr } = await db
      .from("portal_listings")
      .update({ last_confirmed_at: r.created_at })
      .eq("id", r.portal_listing_id)
      .eq("tenant_id", r.tenant_id)
      .eq("status", "live")
      .or(`last_confirmed_at.is.null,last_confirmed_at.lt."${r.created_at}"`)
      .select("id");
    if (upErr) console.error("consumeControlEvents confirm", { code: upErr.code });
    else out.confirmed += (upd ?? []).length;
  }

  const nowIso = new Date(nowMs).toISOString();
  for (const part of chunk(rows.map((r) => r.id), 200)) {
    const { error: upErr } = await db.from("listing_control_events").update({ processed_at: nowIso }).in("id", part);
    if (upErr) console.error("consumeControlEvents mark", { code: upErr.code });
  }

  const processedCut = new Date(nowMs - PROCESSED_KEEP_DAYS * 86_400_000).toISOString();
  const unprocessedCut = new Date(nowMs - UNPROCESSED_KEEP_DAYS * 86_400_000).toISOString();
  const [a, b] = await Promise.all([
    db.from("listing_control_events").delete({ count: "exact" }).not("processed_at", "is", null).lt("created_at", processedCut),
    db.from("listing_control_events").delete({ count: "exact" }).is("processed_at", null).lt("created_at", unprocessedCut),
  ]);
  out.purged = (a.count ?? 0) + (b.count ?? 0);
  return out;
}
