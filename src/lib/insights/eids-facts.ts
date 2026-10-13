import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { DAY_MS, trDayKey } from "@/lib/clock";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";

/**
 * EİDS içgörü olguları (eids_revoked_still_live@1, eids_unknown_live@1, eids_no_email_seen@1, eids_mail_silent@1).
 * `admin` engine'den gelir (istemci OLUŞTURULMAZ); her sorgu AÇIK tenant_id filtreli, örnek veri (is_sample) ve silinmiş /
 * kapanmış portföy dışarıda. Dört kural aynı ofis turunda AYNI portföy olgu kümesini paylaşır (son anahtar önbelleği).
 *
 * EP2 sütunları (authority_eids_verified_at, authority_last_email_at) okunamazsa portföy kümesi yine yüklenir ama
 * `confirmationsKnown=false` olur: "e-posta görülmedi" kuralı bu durumda "etkin değil" sayılır (uydurma kart yok).
 */

export type EidsPropertyFact = {
  propertyId: string;
  assignedTo: string | null;
  label: string | null;
  status: string | null;
  eidsStatus: string | null;
  eidsNo: string | null;
  authorizationEnd: string | null;
  approvedAt: string | null;
  /** Son e-posta / belge / portal teyidi (EP2); sütun yoksa null. */
  lastConfirmationAt: string | null;
  /** Ofisin canlı portal_listings kayıt sayısı. */
  liveListings: number;
};

export type EidsPropertyFacts = { facts: EidsPropertyFact[]; confirmationsKnown: boolean; todayKey: string };

const CLOSED = "(sold,rented,archived,withdrawn,passive)";
const BASE_COLUMNS = "id, title, property_code, assigned_to, status, authority_eids_status, eids_property_no, authorization_end, authority_owner_approved_at";
const EP2_COLUMNS = ", authority_eids_verified_at, authority_last_email_at";

type Row = {
  id: string;
  title: string | null;
  property_code: string | null;
  assigned_to: string | null;
  status: string | null;
  authority_eids_status: string | null;
  eids_property_no: string | null;
  authorization_end: string | null;
  authority_owner_approved_at: string | null;
  authority_eids_verified_at?: string | null;
  authority_last_email_at?: string | null;
};

type PageResult = PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>;

async function loadRows(admin: SupabaseClient, tenantId: string, columns: string) {
  // Sütun listesi çalışma anında seçildiği için (EP2 sütunları var/yok) tip çıkarımı yapılamaz: satır tipi elle verilir.
  return fetchAllRowsKeepError<Row, { message: string; code?: string }>(
    (from, to) =>
      admin
        .from("properties")
        .select(columns)
        .eq("tenant_id", tenantId)
        .eq("is_sample", false)
        .is("deleted_at", null)
        .not("status", "in", CLOSED)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PageResult,
  );
}

const maxIso = (a: string | null | undefined, b: string | null | undefined): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
};

export async function loadEidsPropertyFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<EidsPropertyFacts> {
  let confirmationsKnown = true;
  let res = await loadRows(admin, tenantId, BASE_COLUMNS + EP2_COLUMNS);
  if (res.error && isMissingSchemaError(res.error)) {
    confirmationsKnown = false;
    res = await loadRows(admin, tenantId, BASE_COLUMNS);
  }
  if (res.error) {
    if (isMissingSchemaError(res.error)) throw new InsightFactsUnavailable("properties(eids)");
    throw new Error(`properties(eids): ${res.error.code ?? "hata"}`);
  }

  const { data: live, error: lErr } = await fetchAllRowsKeepError<{ property_id: string }, { message: string; code?: string }>((from, to) =>
    admin.from("portal_listings").select("property_id").eq("tenant_id", tenantId).eq("status", "live").order("id", { ascending: true }).range(from, to),
  );
  if (lErr) throw new Error(`portal_listings(eids): ${lErr.code ?? "hata"}`);
  const liveBy = new Map<string, number>();
  for (const l of live) liveBy.set(l.property_id, (liveBy.get(l.property_id) ?? 0) + 1);

  return {
    confirmationsKnown,
    todayKey: trDayKey(nowMs),
    facts: res.data.map((r) => ({
      propertyId: r.id,
      assignedTo: r.assigned_to,
      label: r.title ?? r.property_code,
      status: r.status,
      eidsStatus: r.authority_eids_status,
      eidsNo: r.eids_property_no,
      authorizationEnd: r.authorization_end ? String(r.authorization_end).slice(0, 10) : null,
      approvedAt: r.authority_owner_approved_at,
      lastConfirmationAt: confirmationsKnown ? maxIso(r.authority_last_email_at, r.authority_eids_verified_at) : null,
      liveListings: liveBy.get(r.id) ?? 0,
    })),
  };
}

// Dört kural aynı turda aynı kümeyi paylaşır (ofis + tur zamanı).
let memo: { key: string; value: Promise<EidsPropertyFacts> } | null = null;
export function eidsPropertyFactsOnce(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<EidsPropertyFacts> {
  const key = `${tenantId}:${nowMs}`;
  if (memo?.key === key) return memo.value;
  const value = loadEidsPropertyFacts(admin, tenantId, nowMs);
  memo = { key, value };
  value.catch(() => {
    if (memo?.key === key) memo = null;
  });
  return value;
}

/** eids_mail_silent@1 olgusu: aktif alma adresi + son 90 günde elle girilen yetki sayısı. */
export type EidsMailSilentFact = {
  addressCreatedAt: string;
  lastReceivedAt: string | null;
  manualGrants90d: number;
};

export async function loadEidsMailSilentFact(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<EidsMailSilentFact | null> {
  const { data: addr, error } = await admin
    .from("eids_inbound_addresses")
    .select("created_at, last_received_at")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) throw new InsightFactsUnavailable("eids_inbound_addresses");
    throw new Error(`eids_inbound_addresses: ${error.code ?? "hata"}`);
  }
  if (!addr) return null;
  const since = new Date(nowMs - 90 * DAY_MS).toISOString();
  const { count, error: cErr } = await admin
    .from("eids_authority_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("source", "manual")
    .in("kind", ["grant", "manual_set"])
    .eq("new_status", "approved")
    .gte("created_at", since);
  if (cErr) {
    if (isMissingSchemaError(cErr)) throw new InsightFactsUnavailable("eids_authority_events");
    throw new Error(`eids_authority_events: ${cErr.code ?? "hata"}`);
  }
  const a = addr as { created_at: string; last_received_at: string | null };
  return { addressCreatedAt: a.created_at, lastReceivedAt: a.last_received_at, manualGrants90d: count ?? 0 };
}
