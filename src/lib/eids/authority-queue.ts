import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import {
  classifyAuthority,
  summarizeAuthorityQueue,
  type AuthorityQueueFilter,
  type AuthorityQueueRow,
  type AuthorityQueueSummary,
  type EidsDisplayStatus,
} from "./authority-status";
import type { AuthorityTerm } from "./authority-term";

/**
 * Yetki kuyruğu okuyucusu — oturumlu istemci (RLS), service_role yok. Yeni sütunlar (20261008001300) okunamazsa
 * `available:false` döner: migration uygulanmamış ortamda uydurma sayı üretilmez.
 */
const SCAN = 2000;

export type AuthorityQueueItem = AuthorityQueueRow & {
  property_code: string | null;
  title: string | null;
  assigned_to: string | null;
  term: AuthorityTerm;
  display: EidsDisplayStatus;
  buckets: AuthorityQueueFilter[];
  owner: { customerId: string; name: string; hasPhone: boolean } | null;
};

export type AuthorityQueueLoad =
  | { available: false }
  | { available: true; items: AuthorityQueueItem[]; summary: AuthorityQueueSummary; truncated: boolean; /** Yetki defteri sütunları okunabildi mi. */ ledger: boolean };

const COLUMNS =
  "id, property_code, title, status, assigned_to, authorization_start, authorization_end, authority_doc_no, authority_eids_status, authority_owner_approved_at, authority_reminder_sent_at, authority_reminder_count";
/** Yetki defteri sütunları (20261013007100). Yoksa eski seçime düşülür; "teyitsiz" kovası o zaman ölçülmez. */
const LEDGER_COLUMNS = "authority_eids_source, authority_eids_verified_at, authority_last_email_at, eids_exempt_reason";

type PropRow = AuthorityQueueRow & { property_code: string | null; title: string | null; assigned_to: string | null };

/**
 * "Kaldır" kovası girdileri (B082): portalda canlı kaydı olan ve açık `eids_takedown` görevi olan portföy kimlikleri.
 * Okunamazsa boş küme (kova ölçülmez, diğer kovalar etkilenmez). Ana sorguyla aynı turda koşar.
 */
async function loadTakedownSignals(supabase: SupabaseClient, tenantId: string): Promise<{ live: Set<string>; takedown: Set<string> }> {
  const [live, tasks] = await Promise.all([
    readAllPaged<{ property_id: string | null }>((from, to) =>
      supabase.from("portal_listings").select("property_id").eq("tenant_id", tenantId).eq("status", "live").order("id").range(from, to),
    ),
    readAllPaged<{ property_id: string | null }>((from, to) =>
      supabase
        .from("tasks")
        .select("property_id")
        .eq("tenant_id", tenantId)
        .eq("kind", "eids_takedown")
        .eq("status", "open")
        .order("id")
        .range(from, to),
    ),
  ]);
  const ids = (r: { rows: { property_id: string | null }[]; error: string | null }) =>
    new Set(r.error ? [] : r.rows.map((x) => x.property_id).filter((v): v is string => Boolean(v)));
  return { live: ids(live), takedown: ids(tasks) };
}

export async function loadAuthorityQueue(supabase: SupabaseClient, tenantId: string): Promise<AuthorityQueueLoad> {
  const signalsP = loadTakedownSignals(supabase, tenantId);
  const query = (cols: string) =>
    supabase
      .from("properties")
      .select(cols)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("is_sample", false)
      .order("authorization_end", { ascending: true, nullsFirst: false })
      .limit(SCAN);
  let ledger = true;
  let res = await query(`${COLUMNS}, ${LEDGER_COLUMNS}`);
  if (res.error && isMissingSchema(res.error)) {
    ledger = false;
    res = await query(COLUMNS);
  }
  if (res.error) return { available: false };
  const signals = await signalsP;
  const rows = ((res.data ?? []) as unknown as PropRow[]).map((r) => ({
    ...r,
    portal_live: signals.live.has(r.id),
    takedown_open: signals.takedown.has(r.id),
  }));
  const nowMs = now();
  const summary = summarizeAuthorityQueue(rows, nowMs);

  const queued = rows
    .map((r) => ({ r, c: classifyAuthority(r, nowMs) }))
    .filter((x) => x.c.buckets.length > 0);

  // Mal sahibi (property_owner_info.customer_id → customers): iki ayrı sorgu, PostgREST gömmesi yok.
  const owners = new Map<string, { customerId: string; name: string; hasPhone: boolean }>();
  const propertyIds = queued.map((x) => x.r.id);
  const ownerRows: { property_id: string; customer_id: string | null }[] = [];
  for (let i = 0; i < propertyIds.length; i += 200) {
    const { data: o } = await supabase
      .from("property_owner_info")
      .select("property_id, customer_id")
      .eq("tenant_id", tenantId)
      .in("property_id", propertyIds.slice(i, i + 200));
    ownerRows.push(...((o ?? []) as { property_id: string; customer_id: string | null }[]));
  }
  const customerIds = [...new Set(ownerRows.map((o) => o.customer_id).filter((v): v is string => Boolean(v)))];
  const customers = new Map<string, { name: string; hasPhone: boolean }>();
  for (let i = 0; i < customerIds.length; i += 200) {
    const { data: c } = await supabase
      .from("customers")
      .select("id, full_name, phone")
      .eq("tenant_id", tenantId)
      .in("id", customerIds.slice(i, i + 200));
    for (const row of (c ?? []) as { id: string; full_name: string | null; phone: string | null }[]) {
      customers.set(row.id, { name: row.full_name ?? "Mal sahibi", hasPhone: Boolean(row.phone?.trim()) });
    }
  }
  for (const o of ownerRows) {
    const c = o.customer_id ? customers.get(o.customer_id) : undefined;
    if (o.customer_id && c) owners.set(o.property_id, { customerId: o.customer_id, ...c });
  }

  const items: AuthorityQueueItem[] = queued.map(({ r, c }) => ({
    ...r,
    term: c.term,
    display: c.display,
    buckets: c.buckets,
    owner: owners.get(r.id) ?? null,
  }));
  return { available: true, items, summary, truncated: rows.length >= SCAN, ledger };
}
