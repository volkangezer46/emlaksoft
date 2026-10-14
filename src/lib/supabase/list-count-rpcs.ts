/**
 * Teklif / talep / hedef sayfalarının sayaçları tek turda (YD7, migration 20261015047020; SECURITY INVOKER → RLS çağıranın
 * yetkisiyle). RPC yoksa/hata verirse `null` döner; çağıran eski head-count sorgularına düşer (rpc-probe deseni, count-rpcs.ts
 * ile aynı). Sahte sıfır üretilmez: bozuk yanıt da `null`.
 */
import type { ScopeFilter } from "@/lib/access-control/query-scope";
import { scopeOwnerIds } from "@/lib/supabase/count-rpcs";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function call<T>(supabase: RpcClient, name: string, args: Record<string, unknown>, parse: (raw: unknown) => T | null): Promise<T | null> {
  if (rpcKnownMissing(name)) return null;
  try {
    const res = await supabase.rpc(name, args);
    recordRpcOutcome(name, res.error);
    if (res.error || res.data == null) return null;
    return parse(res.data);
  } catch {
    return null;
  }
}

// ---- /app/teklifler -------------------------------------------------------------------------------------------------

export const OFFER_COUNTS_RPC = "offer_counts";
export type OfferCounts = { total: number; byStatus: Record<string, number> };

export function parseOfferCounts(raw: unknown): OfferCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const total = num(r.total);
  if (total === null || !r.by_status || typeof r.by_status !== "object" || Array.isArray(r.by_status)) return null;
  const byStatus: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.by_status as Record<string, unknown>)) {
    const n = num(v);
    if (n === null) return null;
    byStatus[k] = n;
  }
  return { total, byStatus };
}

/** Toplam + duruma göre teklif sayısı; `createdBy` verilirse yalnız o danışmanın teklifleri (sayfadaki kapsam süzgeci). */
export function loadOfferCounts(supabase: RpcClient, createdBy: string | null): Promise<OfferCounts | null> {
  return call(supabase, OFFER_COUNTS_RPC, { p_created_by: createdBy }, parseOfferCounts);
}

// ---- /app/talepler --------------------------------------------------------------------------------------------------

export const DEMAND_COUNTS_RPC = "demand_counts";
const DEMAND_KEYS = ["new", "active", "matched", "closed", "urgent", "high", "aging"] as const;
export type DemandCounts = Record<(typeof DEMAND_KEYS)[number], number>;

export function parseDemandCounts(raw: unknown): DemandCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<DemandCounts> = {};
  for (const k of DEMAND_KEYS) {
    const n = num(r[k]);
    if (n === null) return null;
    out[k] = n;
  }
  return out as DemandCounts;
}

/**
 * Talep sayaçları (kullanıcı süzgeci OLMADAN, yalnız danışman/kapsam): 4 durum + açık acil/yüksek + açık yaşlanan.
 * Kapsam müşteri üzerinden (customers.assigned_to), sayfadaki `!inner` gömmesiyle aynı.
 */
export function loadDemandCounts(
  supabase: RpcClient,
  args: { scope: ScopeFilter; advisorId: string | null; openStatuses: string[]; agingBeforeIso: string },
): Promise<DemandCounts | null> {
  return call(supabase, DEMAND_COUNTS_RPC, {
    p_owner_ids: scopeOwnerIds(args.scope),
    p_advisor: args.advisorId,
    p_open_statuses: args.openStatuses,
    p_aging_before: args.agingBeforeIso,
  }, parseDemandCounts);
}

// ---- /app/hedefler --------------------------------------------------------------------------------------------------

export const TARGET_ACTIVITY_COUNTS_RPC = "target_activity_counts";
export type TargetActivityItem = {
  id: string;
  startIso: string;
  endIso: string;
  profileId: string | null;
  appointments: boolean;
  listings: boolean;
};
export type TargetActivity = { appointments: number | null; listings: number | null };

export function parseTargetActivityCounts(raw: unknown, items: readonly TargetActivityItem[]): Map<string, TargetActivity> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out = new Map<string, TargetActivity>();
  for (const it of items) {
    const row = r[it.id];
    if (!row || typeof row !== "object") return null;
    const v = row as Record<string, unknown>;
    const a = it.appointments ? num(v.appointments) : null;
    const l = it.listings ? num(v.listings) : null;
    if ((it.appointments && a === null) || (it.listings && l === null)) return null;
    out.set(it.id, { appointments: a, listings: l });
  }
  return out;
}

/** Hedef başına randevu / yeni portföy gerçekleşmesi tek sorguda (hedef başına 2 head-count yerine). */
export async function loadTargetActivityCounts(
  supabase: RpcClient,
  tenantId: string,
  items: readonly TargetActivityItem[],
): Promise<Map<string, TargetActivity> | null> {
  if (items.length === 0) return new Map();
  return call(supabase, TARGET_ACTIVITY_COUNTS_RPC, {
    p_tenant_id: tenantId,
    p_items: items.map((i) => ({
      id: i.id,
      start_at: i.startIso,
      end_at: i.endIso,
      profile_id: i.profileId,
      want_appointments: i.appointments,
      want_listings: i.listings,
    })),
  }, (raw) => parseTargetActivityCounts(raw, items));
}
