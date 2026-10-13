import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import type { MailAuthResult } from "./mail-auth";
import type { InboundVia, MatchStatus } from "./inbound-policy";

/**
 * EİDS e-posta kayıtlarının OKUYUCUSU — oturumlu istemci (RLS: ofis içi, portallar görüntüleme). service_role yok.
 * Tablo yoksa (migration uygulanmamış) `available:false` döner; uydurma sayı üretilmez.
 */

export type InboundListItem = {
  id: string;
  received_via: InboundVia;
  received_at: string;
  auth_result: MailAuthResult;
  parse_kind: "grant" | "revoke" | "unknown" | "forward_confirmation" | null;
  eids_property_no: string | null;
  deal_kind: "sale" | "rent" | null;
  grantor_masked: string | null;
  valid_until: string | null;
  match_status: MatchStatus | null;
  property_id: string | null;
  candidate_property_ids: string[];
};

const LIST_COLUMNS =
  "id, received_via, received_at, auth_result, parse_kind, eids_property_no, deal_kind, grantor_masked, valid_until, match_status, property_id, candidate_property_ids";

export type ForwardConfirmationView = { provider: string; code: string | null; url: string | null; receivedAt: string; expiresAt: string };

export type MailboxSummary =
  | { available: false }
  | { available: true; recent: InboundListItem[]; confirmation: ForwardConfirmationView | null; lastReceivedAt: string | null; pendingCount: number };

/** Ayarlar kartı: son 10 e-posta, geçerli iletme onayı (24 saat), son alınan zaman, kontrol bekleyen sayısı. */
export async function loadMailboxSummary(db: SupabaseClient, tenantId: string): Promise<MailboxSummary> {
  const nowIso = new Date(now()).toISOString();
  const [recent, confirm, pending] = await Promise.all([
    db.from("eids_inbound_messages").select(LIST_COLUMNS).eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(10),
    db
      .from("eids_inbound_messages")
      .select("confirm_provider, confirm_code, confirm_url, received_at, confirm_expires_at")
      .eq("tenant_id", tenantId)
      .eq("parse_kind", "forward_confirmation")
      .gt("confirm_expires_at", nowIso)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("eids_inbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("match_status", ["queued", "candidate", "no_match"]),
  ]);
  if (recent.error) return { available: false };
  const items = (recent.data ?? []) as InboundListItem[];
  const c = confirm.data as { confirm_provider: string; confirm_code: string | null; confirm_url: string | null; received_at: string; confirm_expires_at: string } | null;
  return {
    available: true,
    recent: items,
    confirmation: c ? { provider: c.confirm_provider, code: c.confirm_code, url: c.confirm_url, receivedAt: c.received_at, expiresAt: c.confirm_expires_at } : null,
    lastReceivedAt: items[0]?.received_at ?? null,
    pendingCount: pending.count ?? 0,
  };
}

export type ReviewQueueItem = InboundListItem & {
  options: { id: string; code: string | null; title: string | null; transaction_type: string | null }[];
};

export type ReviewQueueLoad = { available: false } | { available: true; items: ReviewQueueItem[]; total: number };

const QUEUE_LIMIT = 50;

/** İlan Kontrol > Yetki > Kontrol bekliyor: onay bekleyen yetki e-postaları + seçilebilir portföyler. */
export async function loadReviewQueue(db: SupabaseClient, tenantId: string): Promise<ReviewQueueLoad> {
  const { data, error, count } = await db
    .from("eids_inbound_messages")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .in("match_status", ["queued", "candidate", "no_match"])
    .in("parse_kind", ["grant", "revoke"])
    .order("received_at", { ascending: false })
    .limit(QUEUE_LIMIT);
  if (error) return { available: false };
  const rows = (data ?? []) as InboundListItem[];
  const ids = [...new Set(rows.flatMap((r) => [r.property_id, ...(r.candidate_property_ids ?? [])]).filter((v): v is string => Boolean(v)))];
  const props = new Map<string, { id: string; code: string | null; title: string | null; transaction_type: string | null }>();
  if (ids.length > 0) {
    const { data: p } = await db
      .from("properties")
      .select("id, property_code, title, transaction_type")
      .eq("tenant_id", tenantId)
      .in("id", ids.slice(0, 200))
      .is("deleted_at", null);
    for (const r of (p ?? []) as { id: string; property_code: string | null; title: string | null; transaction_type: string | null }[]) {
      props.set(r.id, { id: r.id, code: r.property_code, title: r.title, transaction_type: r.transaction_type });
    }
  }
  const items = rows.map((r) => {
    const optionIds = [r.property_id, ...(r.candidate_property_ids ?? [])].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);
    return { ...r, options: optionIds.map((id) => props.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v)) };
  });
  return { available: true, items, total: count ?? items.length };
}
