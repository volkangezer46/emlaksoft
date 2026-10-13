import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { summarizeEids, type EidsPropertyRow, type EidsSummary } from "./status";
import { eidsNoMatchKey } from "./property-no";
import { isEidsInScope } from "./status";
import {
  maskGrantorName,
  matchExact,
  rankCandidates,
  MAX_EIDS_CANDIDATES,
  type EidsCandidate,
  type EidsMatchFacts,
  type EidsMatchProperty,
  type EidsMatchResult,
} from "./match";

/**
 * EİDS durum okuyucusu — oturumlu istemci (RLS), service_role yok. Kolon okunamazsa `enabled:false` döner
 * (migration uygulanmamış ortamda uydurma sayı yok).
 */

const SCAN = 2000;
/** Liste sorgusuna `id in (...)` olarak inen en çok kimlik (PostgREST URL sınırı). */
export const EIDS_ID_CAP = 150;

export type EidsStatusLoad = { enabled: false } | { enabled: true; summary: EidsSummary; truncated: boolean };

export async function loadEidsStatus(supabase: SupabaseClient): Promise<EidsStatusLoad> {
  const base = "id, status, eids_property_no, authorization_start, authorization_end";
  // İstisna sütunu (20261013007100) yoksa eski seçime düşülür: istisnalar o zaman "EİDS eksik" sayılır.
  const query = (cols: string) => supabase.from("properties").select(cols).is("deleted_at", null).order("created_at", { ascending: false }).limit(SCAN);
  let res = await query(`${base}, eids_exempt_reason`);
  if (res.error && isMissingSchema(res.error)) res = await query(base);
  if (res.error) return { enabled: false };
  const rows = (res.data ?? []) as unknown as EidsPropertyRow[];
  return { enabled: true, summary: summarizeEids(rows, now()), truncated: rows.length >= SCAN };
}

// ---------------------------------------------------------------------------------------------------------------------
// Portföy yetki kartı + olay geçmişi
// ---------------------------------------------------------------------------------------------------------------------

export type AuthorityEventRow = {
  id: string;
  seq: number;
  kind: string;
  source: string;
  prev_status: string | null;
  new_status: string | null;
  valid_until: string | null;
  deal_kind: string | null;
  grantor_masked: string | null;
  eids_property_no: string | null;
  actor_id: string | null;
  undo_of: string | null;
  note: string | null;
  evidence_media_id: string | null;
  inbound_message_id: string | null;
  created_at: string;
};

const EVENT_COLUMNS =
  "id, seq, kind, source, prev_status, new_status, valid_until, deal_kind, grantor_masked, eids_property_no, actor_id, undo_of, note, evidence_media_id, inbound_message_id, created_at";

export type AuthorityEventsLoad = { available: false } | { available: true; events: AuthorityEventRow[] };

/** Portföyün son yetki olayları (yeni → eski). Tablo yoksa `available:false` ("kurulum bekliyor"). */
export async function loadAuthorityEvents(db: SupabaseClient, tenantId: string, propertyId: string, limit = 20): Promise<AuthorityEventsLoad> {
  const { data, error } = await db
    .from("eids_authority_events")
    .select(EVENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .order("seq", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) return { available: false };
  return { available: true, events: (data ?? []) as AuthorityEventRow[] };
}

/**
 * Geri alınabilir son olay: portföyün override dışındaki en yeni olayı, kendisi geri alma değilse ve henüz geri
 * alınmamışsa. (Sunucu RPC'si aynı kuralı kilitle yeniden denetler; burası yalnız düğmeyi göstermek içindir.)
 */
export function undoableEvent(events: readonly AuthorityEventRow[]): AuthorityEventRow | null {
  const latest = events.find((e) => e.kind !== "override");
  if (!latest || latest.kind === "undo") return null;
  if (events.some((e) => e.undo_of === latest.id)) return null;
  return latest;
}

/**
 * Owner izni etkin mi: son durum olayından SONRA verilmiş ve `ttlHours` dolmamış override var mı.
 * `events` yeni → eski sıralıdır.
 */
export function activeOverride(events: readonly AuthorityEventRow[], nowMs: number, ttlHours: number): AuthorityEventRow | null {
  for (const e of events) {
    if (e.kind !== "override") return null;
    const at = Date.parse(e.created_at);
    if (Number.isFinite(at) && nowMs - at <= ttlHours * 3_600_000) return e;
  }
  return null;
}

/** Birden çok portföyün geri alınabilir son olayı (kuyruk satırları için; tek sorgu, en iyi çaba). */
export async function loadLatestUndoable(db: SupabaseClient, tenantId: string, propertyIds: readonly string[]): Promise<Map<string, AuthorityEventRow>> {
  const out = new Map<string, AuthorityEventRow>();
  if (propertyIds.length === 0) return out;
  const ids = propertyIds.slice(0, EIDS_ID_CAP);
  const { data, error } = await db
    .from("eids_authority_events")
    .select(EVENT_COLUMNS + ", property_id")
    .eq("tenant_id", tenantId)
    .in("property_id", ids)
    .order("seq", { ascending: false })
    .limit(ids.length * 4);
  if (error || !data) return out;
  const byProp = new Map<string, AuthorityEventRow[]>();
  for (const row of data as unknown as (AuthorityEventRow & { property_id: string })[]) {
    const list = byProp.get(row.property_id) ?? [];
    list.push(row);
    byProp.set(row.property_id, list);
  }
  for (const [pid, list] of byProp) {
    const u = undoableEvent(list);
    if (u) out.set(pid, u);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Eşleştirme (bildirim → portföy)
// ---------------------------------------------------------------------------------------------------------------------

export type AuthorityMatchCandidate = EidsCandidate & {
  property_code: string | null;
  title: string | null;
  transaction_type: string | null;
  eids_property_no: string | null;
  /** Ekranda maskeli gösterilir; açık ad yalnız sunucuda karşılaştırılır. */
  owner_masked: string | null;
};

export type AuthorityMatchLoad =
  | { ok: false; error: string }
  | {
      ok: true;
      result: EidsMatchResult;
      /** Birebir eşleşme yoksa (ya da belirsizse) en çok 5 aday. Otomatik bağlanmaz. */
      candidates: AuthorityMatchCandidate[];
      /** Belirsiz eşleşmede aynı numaralı portföyler (kullanıcı seçer). */
      ambiguous: { id: string; property_code: string | null; title: string | null; transaction_type: string | null }[];
    };

type PropRow = EidsMatchProperty & {
  property_code: string | null;
  title: string | null;
  owner_customer_id: string | null;
};

const MATCH_COLUMNS = "id, property_code, title, status, transaction_type, eids_property_no, authorization_end, district_id, neighborhood_id, owner_customer_id";

async function attachOwnerNames(db: SupabaseClient, tenantId: string, rows: PropRow[]): Promise<void> {
  const missing = rows.filter((r) => !r.owner_customer_id).map((r) => r.id);
  const ownerByProp = new Map<string, string>();
  for (const r of rows) if (r.owner_customer_id) ownerByProp.set(r.id, r.owner_customer_id);
  if (missing.length > 0) {
    const { data } = await db.from("property_owner_info").select("property_id, customer_id").eq("tenant_id", tenantId).in("property_id", missing.slice(0, 200));
    for (const o of (data ?? []) as { property_id: string; customer_id: string | null }[]) if (o.customer_id) ownerByProp.set(o.property_id, o.customer_id);
  }
  const customerIds = [...new Set(ownerByProp.values())];
  const names = new Map<string, string>();
  for (let i = 0; i < customerIds.length; i += 200) {
    const { data } = await db.from("customers").select("id, full_name").eq("tenant_id", tenantId).in("id", customerIds.slice(i, i + 200));
    for (const c of (data ?? []) as { id: string; full_name: string | null }[]) if (c.full_name) names.set(c.id, c.full_name);
  }
  for (const r of rows) {
    const cid = ownerByProp.get(r.id);
    r.owner_name = cid ? (names.get(cid) ?? null) : null;
  }
}

/**
 * Ofis içinde bildirim → portföy eşleştirmesi. Kiracı sınırı her sorguda açık `.eq("tenant_id")` + RLS.
 * 1) Taşınmaz no birebir (rakam anahtarı) → `matchExact` (tür ile ayırt etme, malik/bitiş uyarıları).
 * 2) Birebir yoksa ya da belirsizse aday listesi: pg_trgm ön süzgeci (`eids_authority_candidates`; yoksa ofisin açık
 *    portföylerinde uygulama tarafı trigram) → `rankCandidates` (en çok 5).
 * HİÇBİR ŞEY YAZMAZ.
 */
export async function findAuthorityMatch(db: SupabaseClient, tenantId: string, facts: EidsMatchFacts): Promise<AuthorityMatchLoad> {
  const key = eidsNoMatchKey(facts.propertyNo ?? null);
  if (!key) return { ok: false, error: "Ne oldu: taşınmaz numarası okunamadı. Ne yapmalı: bildirimdeki numarayı (en az 6 rakam) girin." };

  // (1) Birebir: numara tam eşitse ya da rakamları içeriyorsa (ayraçlı kayıt) getir, son karar rakam anahtarıyla.
  const exactRes = await db
    .from("properties")
    .select(MATCH_COLUMNS)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("eids_property_no", "is", null)
    .or(`eids_property_no.eq.${key},eids_property_no.like.*${key.slice(-6)}*`)
    .limit(50);
  if (exactRes.error) {
    return { ok: false, error: isMissingSchema(exactRes.error) ? "EİDS eşleştirmesi için sistem güncellemesi bekleniyor." : "Portföyler okunamadı; birkaç saniye sonra tekrar deneyin." };
  }
  const exactRows = ((exactRes.data ?? []) as PropRow[]).filter((r) => eidsNoMatchKey(r.eids_property_no) === key);
  await attachOwnerNames(db, tenantId, exactRows);
  const result = matchExact(facts, exactRows);
  if (result.kind === "exact") return { ok: true, result, candidates: [], ambiguous: [] };

  const ambiguous =
    result.kind === "ambiguous"
      ? exactRows.filter((r) => result.propertyIds.includes(r.id)).map((r) => ({ id: r.id, property_code: r.property_code, title: r.title, transaction_type: r.transaction_type }))
      : [];

  // (2) Adaylar.
  let pool: (PropRow & { nameSimilarity?: number | null })[] = [];
  const name = (facts.grantorName ?? "").trim();
  if (name.length >= 3) {
    const rpc = await db.rpc("eids_authority_candidates", { p_tenant_id: tenantId, p_grantor_name: name, p_limit: 40 });
    if (!rpc.error) {
      const sims = new Map(((rpc.data ?? []) as { property_id: string; name_similarity: number }[]).map((r) => [r.property_id, Number(r.name_similarity)]));
      if (sims.size > 0) {
        const { data } = await db.from("properties").select(MATCH_COLUMNS).eq("tenant_id", tenantId).is("deleted_at", null).in("id", [...sims.keys()]);
        pool = ((data ?? []) as PropRow[]).filter((r) => isEidsInScope(r.status));
      }
    } else if (!isMissingSchema(rpc.error)) {
      console.error("eids_authority_candidates", { code: rpc.error.code });
    }
  }
  if (pool.length === 0 && (name.length >= 3 || facts.districtId || facts.neighborhoodId)) {
    // pg_trgm/RPC yoksa ya da ön süzgeç boşsa: ofisin açık portföyleri (EİDS no'su boş olanlar önce) uygulama tarafında puanlanır.
    let q = db.from("properties").select(MATCH_COLUMNS).eq("tenant_id", tenantId).is("deleted_at", null);
    if (facts.neighborhoodId) q = q.eq("neighborhood_id", facts.neighborhoodId);
    else if (facts.districtId) q = q.eq("district_id", facts.districtId);
    const { data } = await q.order("created_at", { ascending: false }).limit(500);
    pool = ((data ?? []) as PropRow[]).filter((r) => isEidsInScope(r.status));
  }
  await attachOwnerNames(db, tenantId, pool);
  const ranked = rankCandidates(facts, pool, MAX_EIDS_CANDIDATES);
  const byId = new Map(pool.map((r) => [r.id, r]));
  const candidates: AuthorityMatchCandidate[] = ranked.map((c) => {
    const r = byId.get(c.propertyId)!;
    return {
      ...c,
      property_code: r.property_code,
      title: r.title,
      transaction_type: r.transaction_type,
      eids_property_no: r.eids_property_no,
      owner_masked: maskGrantorName(r.owner_name),
    };
  });
  return { ok: true, result, candidates, ambiguous };
}
