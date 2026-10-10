import { isMissingSchema, type Db } from "@/lib/listing-control/server/db";

/**
 * Günlük eşleştirme özeti okuyucuları (KULLANICI OTURUMU, RLS; service_role YOK). Tablo/kolon yoksa (migration
 * 20261010000500 uygulanmamış) ilgili parça boş döner; ekran dürüstçe "veri yok" der.
 */

export type SyncOverview = {
  /** Eşleşme kuyruğunu görebilen rol mü (RLS yalnız yönetim kademesine açar). */
  queueAvailable: boolean;
  suggested: number;
  unsure: number;
  orphan: number;
  lastImport: { at: string; complete: boolean; portal: string; read: number | null; expected: number | null } | null;
};

export async function loadSyncOverview(db: Db): Promise<SyncOverview> {
  const head = { count: "exact", head: true } as const;
  const cand = () => db.from("listing_matching_candidates").select("id", head).eq("status", "open");
  const [rs, ru, ro, imp] = await Promise.all([
    cand().gte("top_score", 85),
    cand().gte("top_score", 60).lt("top_score", 85),
    cand().or("top_score.is.null,top_score.lt.60"),
    (async () => {
      const full = await db.from("listing_inventory_imports").select("created_at, complete, portal, read_count, expected_count").eq("source", "extension").order("created_at", { ascending: false }).limit(1);
      if (full.error && isMissingSchema(full.error)) {
        return db.from("listing_inventory_imports").select("created_at, complete, portal").eq("source", "extension").order("created_at", { ascending: false }).limit(1);
      }
      return full;
    })(),
  ]);
  const suggested = rs.error ? null : (rs.count ?? 0);
  const unsure = ru.error ? 0 : (ru.count ?? 0);
  const orphan = ro.error ? 0 : (ro.count ?? 0);
  const row = ((imp.data ?? []) as { created_at: string; complete: boolean; portal: string; read_count?: number | null; expected_count?: number | null }[])[0];
  return {
    queueAvailable: suggested !== null,
    suggested: suggested ?? 0,
    unsure,
    orphan,
    lastImport: row ? { at: row.created_at, complete: row.complete, portal: row.portal, read: row.read_count ?? null, expected: row.expected_count ?? null } : null,
  };
}

export type SuggestionRow = {
  id: string;
  portal: string;
  external_id: string;
  title: string | null;
  price: number | null;
  top_score: number;
  property_id: string;
  ambiguous: boolean;
};

/** Onay bekleyen en güçlü eşleşmeler (≥60); ≥85 ve belirsiz olmayanlar tek tık onaylanabilir. */
export async function listSuggestions(db: Db, limit = 4): Promise<SuggestionRow[]> {
  const { data, error } = await db
    .from("listing_matching_candidates")
    .select("id, portal, external_id, title, price, candidates, top_score")
    .eq("status", "open")
    .gte("top_score", 60)
    .order("top_score", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as { id: string; portal: string; external_id: string; title: string | null; price: number | string | null; candidates: { property_id: string; score: number }[] | null; top_score: number | string }[])
    .filter((r) => (r.candidates?.length ?? 0) > 0)
    .map((r) => ({
      id: r.id,
      portal: r.portal,
      external_id: r.external_id,
      title: r.title,
      price: r.price === null ? null : Number(r.price),
      top_score: Number(r.top_score),
      property_id: (r.candidates as { property_id: string }[])[0].property_id,
      ambiguous: (r.candidates ?? []).filter((c) => c.score >= 85).length >= 2,
    }));
}

export type DiffRow = { id: string; type: string; property_id: string; severity: string; last_seen_at: string; details: Record<string, unknown> };

const DIFF_TYPES = ["price_mismatch", "portal_missing", "not_published", "unregistered_listing"] as const;

/** Son farklar: fiyat değişti, ilan kalktı, yayında olmayan portföy, portföyde olmayan ilan (mevcut listing_anomalies). */
export async function listDiffs(db: Db, limit = 8): Promise<DiffRow[]> {
  const { data, error } = await db
    .from("listing_anomalies")
    .select("id, type, property_id, severity, last_seen_at, details")
    .in("type", [...DIFF_TYPES])
    .in("status", ["open", "acknowledged"])
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as DiffRow[];
}
