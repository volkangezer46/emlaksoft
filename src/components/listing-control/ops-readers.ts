import { isMissingSchema, type Db } from "@/lib/listing-control/server/db";

/**
 * Envanter / eşleşme / sorumluluk okuyucuları (KULLANICI OTURUMU, RLS; service_role YOK). Tablo/RPC yoksa (migration
 * 20261007000210 uygulanmamış) `available:false` döner ve ekran dürüst "etkin değil" der.
 */

export type ImportHistoryRow = {
  id: string;
  portal: string;
  scope: "mine" | "office";
  source: "csv" | "paste" | "extension";
  complete: boolean;
  actor_id: string | null;
  total_rows: number;
  matched: number;
  removed: number;
  unregistered: number;
  never_published: number;
  id_invalid: number;
  unverifiable: number;
  other_advisor: number;
  price_diff: number;
  created_at: string;
};

export async function listRecentImports(db: Db, limit = 8): Promise<{ available: boolean; rows: ImportHistoryRow[] }> {
  const { data, error } = await db
    .from("listing_inventory_imports")
    .select("id, portal, scope, source, complete, actor_id, total_rows, matched, removed, unregistered, never_published, id_invalid, unverifiable, other_advisor, price_diff, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) {
    if (!isMissingSchema(error)) console.error("listRecentImports", { code: error.code });
    return { available: false, rows: [] };
  }
  return { available: true, rows: (data ?? []) as ImportHistoryRow[] };
}

export type MatchCandidateRow = {
  id: string;
  portal: string;
  external_id: string;
  url: string | null;
  title: string | null;
  price: number | null;
  source_kind: string;
  candidates: { property_id: string; score: number; signals?: { key: string; label: string; points: number; max: number }[] }[];
  top_score: number | null;
  first_seen_at: string;
  last_seen_at: string;
};

/** Açık eşleşme adayları (en güçlü aday en üstte; adaysızlar en sonda). Sunucu sayfalama. */
/**
 * Eşleşme grupları (güven bantları `matching.ts` MATCH_BANDS ile aynı): `onay` ≥85 tek tık önerilen, `emin` 60-84 "emin değilim",
 * `yok` <60 ya da hiç aday yok (portföyde olmayan ilan). Grup yoksa hepsi.
 */
export type MatchGroup = "onay" | "emin" | "yok";
export const MATCH_GROUPS: readonly MatchGroup[] = ["onay", "emin", "yok"];

export function parseMatchGroup(raw: string | string[] | undefined): MatchGroup | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (MATCH_GROUPS as readonly string[]).includes(v ?? "") ? (v as MatchGroup) : null;
}

export async function listMatchCandidates(db: Db, page: number, pageSize = 20, group: MatchGroup | null = null): Promise<{ available: boolean; rows: MatchCandidateRow[]; total: number }> {
  const size = Math.min(Math.max(pageSize, 1), 50);
  const p = Math.max(page, 1);
  let q = db
    .from("listing_matching_candidates")
    .select("id, portal, external_id, url, title, price, source_kind, candidates, top_score, first_seen_at, last_seen_at", { count: "exact" })
    .eq("status", "open");
  if (group === "onay") q = q.gte("top_score", 85);
  else if (group === "emin") q = q.gte("top_score", 60).lt("top_score", 85);
  else if (group === "yok") q = q.or("top_score.is.null,top_score.lt.60");
  const { data, error, count } = await q
    .order("top_score", { ascending: false, nullsFirst: false })
    .order("last_seen_at", { ascending: false })
    .range((p - 1) * size, p * size - 1);
  if (error) {
    if (!isMissingSchema(error)) console.error("listMatchCandidates", { code: error.code });
    return { available: false, rows: [], total: 0 };
  }
  const rows = ((data ?? []) as MatchCandidateRow[]).map((r) => ({
    ...r,
    price: r.price === null ? null : Number(r.price),
    top_score: r.top_score === null ? null : Number(r.top_score),
    candidates: Array.isArray(r.candidates) ? r.candidates.slice(0, 3) : [],
  }));
  return { available: true, rows, total: count ?? 0 };
}

/** Süresi geçmiş (SLA) açık uyarıların danışman dağılımı ("bugün kimi uyarmalı"). En çok 1000 satırdan sayılır. */
export async function loadOverdueAdvisors(db: Db, nowIso: string): Promise<{ available: boolean; rows: { advisorId: string; count: number }[] }> {
  const { data, error } = await db
    .from("listing_anomalies")
    .select("advisor_id")
    .in("status", ["open", "acknowledged"])
    .lt("sla_due_at", nowIso)
    .not("advisor_id", "is", null)
    .limit(1000);
  if (error) {
    if (!isMissingSchema(error)) console.error("loadOverdueAdvisors", { code: error.code });
    return { available: false, rows: [] };
  }
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { advisor_id: string }[]) counts.set(r.advisor_id, (counts.get(r.advisor_id) ?? 0) + 1);
  return {
    available: true,
    rows: [...counts.entries()].map(([advisorId, count]) => ({ advisorId, count })).sort((a, b) => b.count - a.count),
  };
}
