/**
 * Liste sayfası KPI sayımları için tek-tur RPC'ler (portfolio_counts / task_counts).
 * Migration: supabase/migrations/20261012002200_portfolio_counts_rpc.sql (SECURITY INVOKER → RLS çağıranın yetkisiyle).
 * RPC yoksa/hata verirse `null` döner; çağıran eski head-count sorgularına düşer (rpc-probe deseni). Sahte sıfır üretilmez.
 */
import type { ScopeFilter } from "@/lib/access-control/query-scope";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };

/** applyScopeFilter'ın çözdüğü sahip listesi; süzgeç yoksa null (RPC'de filtre yok). */
export function scopeOwnerIds(filter: ScopeFilter): string[] | null {
  if (filter.kind === "self") return [filter.userId];
  if (filter.kind === "members") return filter.ids;
  return null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type PortfolioCounts = {
  total: number; live: number; pending: number; draft: number; sale: number; rent: number; recent: number;
  green: number; yellow: number; red: number;
};

export function parsePortfolioCounts(raw: unknown): PortfolioCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of ["total", "live", "pending", "draft", "sale", "rent", "recent", "green", "yellow", "red"]) {
    const n = num(r[k]);
    if (n === null) return null;
    out[k] = n;
  }
  return out as PortfolioCounts;
}

export type TaskCounts = {
  all: number; open: number; done: number; overdue: number; today: number; upcoming: number; kinds: Record<string, number>;
};

export function parseTaskCounts(raw: unknown): TaskCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of ["all", "open", "done", "overdue", "today", "upcoming"]) {
    const n = num(r[k]);
    if (n === null) return null;
    out[k] = n;
  }
  const kinds: Record<string, number> = {};
  if (r.kinds && typeof r.kinds === "object") {
    for (const [k, v] of Object.entries(r.kinds as Record<string, unknown>)) {
      const n = num(v);
      if (n !== null) kinds[k] = n;
    }
  }
  return { ...(out as Omit<TaskCounts, "kinds">), kinds };
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

export const PORTFOLIO_COUNTS_RPC = "portfolio_counts";
export const TASK_COUNTS_RPC = "task_counts";

export function portfolioCountsKnownMissing(): boolean {
  return rpcKnownMissing(PORTFOLIO_COUNTS_RPC);
}
export function taskCountsKnownMissing(): boolean {
  return rpcKnownMissing(TASK_COUNTS_RPC);
}

export function loadPortfolioCounts(
  supabase: RpcClient,
  args: {
    scope: ScopeFilter;
    live: string[]; pending: string[]; draft: string[];
    green: string[]; yellow: string[]; red: string[];
    recentSince: string;
  },
): Promise<PortfolioCounts | null> {
  return call(supabase, PORTFOLIO_COUNTS_RPC, {
    p_owner_ids: scopeOwnerIds(args.scope),
    p_live: args.live, p_pending: args.pending, p_draft: args.draft,
    p_green: args.green, p_yellow: args.yellow, p_red: args.red,
    p_recent_since: args.recentSince,
  }, parsePortfolioCounts);
}

export function loadTaskCounts(
  supabase: RpcClient,
  args: { scope: ScopeFilter; nowIso: string; todayStartIso: string; todayEndIso: string; weekEndIso: string; kinds: string[] },
): Promise<TaskCounts | null> {
  return call(supabase, TASK_COUNTS_RPC, {
    p_owner_ids: scopeOwnerIds(args.scope),
    p_now: args.nowIso, p_today_start: args.todayStartIso, p_today_end: args.todayEndIso, p_week_end: args.weekEndIso,
    p_kinds: args.kinds,
  }, parseTaskCounts);
}

// ---- Detay sayfası okuma RPC'leri (20261012002220_detail_read_rpcs.sql) --------------------------------------------

export const DEAL_SIDE_READS_RPC = "deal_side_reads";
export const PROPERTY_REGION_DAYS_RPC = "property_region_days";

export type DealSideReads = {
  offers: { id: string; amount: number; status: string; valid_until: string | null; created_at: string }[];
  appointmentCount: number;
};

export function parseDealSideReads(raw: unknown): DealSideReads | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const count = num(r.appointment_count);
  if (count === null || !Array.isArray(r.offers)) return null;
  return { offers: r.offers as DealSideReads["offers"], appointmentCount: count };
}

/** Anlaşmanın teklifleri (son 10) + iptal olmayan randevu sayısı; anlaşma okumasıyla AYNI turda başlatılır. */
export function loadDealSideReads(supabase: RpcClient, dealId: string): Promise<DealSideReads | null> {
  return call(supabase, DEAL_SIDE_READS_RPC, { p_deal_id: dealId }, parseDealSideReads);
}

/** `{ avgDays }`: RPC cevap verdi (portföy uygun değilse avgDays null); `null`: RPC yok/hata → çağıran eski yola düşer. */
export function parseRegionDays(raw: unknown): { avgDays: number | null } | null {
  if (!raw || typeof raw !== "object" || !("avg_days_listed" in raw)) return null;
  const v = (raw as { avg_days_listed: unknown }).avg_days_listed;
  if (v === null) return { avgDays: null };
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? { avgDays: n } : { avgDays: null };
}

export function loadPropertyRegionDays(supabase: RpcClient, propertyId: string): Promise<{ avgDays: number | null } | null> {
  return call(supabase, PROPERTY_REGION_DAYS_RPC, { p_property_id: propertyId }, parseRegionDays);
}
