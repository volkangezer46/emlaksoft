import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAuditFilters, normalizeAuditFilters, type AuditFilters } from "@/lib/audit-filters";
import { categoryOrExpr, isFeedCategory } from "@/lib/oversight/feed";

/**
 * Islem akisi sorgusu: audit_logs + ortak denetim filtreleri + kategori.
 * URL <-> sunucu sorgusu iki yonludur (liste sayfalari filtre kontrati).
 */

export const FEED_PAGE_SIZE = 40;

export type FeedFilters = Pick<AuditFilters, "from" | "to" | "aktor" | "risk" | "tur"> & { kategori: string };

export function normalizeFeedFilters(raw: Record<string, unknown>): FeedFilters {
  const base = normalizeAuditFilters({ from: raw.from, to: raw.to, aktor: raw.aktor, risk: raw.risk, tur: raw.tur });
  const kat = typeof raw.kategori === "string" ? raw.kategori.trim() : "";
  return {
    from: base.from,
    to: base.to,
    aktor: base.aktor,
    risk: base.risk,
    tur: base.tur,
    kategori: isFeedCategory(kat) ? kat : "",
  };
}

export function hasFeedFilter(f: FeedFilters): boolean {
  return Boolean(f.from || f.to || f.aktor || f.risk || f.tur || f.kategori);
}

export function feedParams(f: FeedFilters, page = 1): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.aktor) sp.set("aktor", f.aktor);
  if (f.risk) sp.set("risk", f.risk);
  if (f.tur) sp.set("tur", f.tur);
  if (f.kategori) sp.set("kategori", f.kategori);
  if (page > 1) sp.set("sayfa", String(page));
  return sp;
}

export type FeedRow = {
  id: string;
  action: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

export type FeedPage = { rows: FeedRow[]; total: number; page: number; totalPages: number; failed: boolean };

/** `forceActorId`: danisman kendi akisi — URL'deki `aktor` yok sayilir (baskasinin akisi sorgulanamaz). */
export async function loadFeedPage(
  supabase: SupabaseClient,
  tenantId: string,
  filters: FeedFilters,
  pageRaw: number,
  forceActorId?: string,
): Promise<FeedPage> {
  const page = Math.max(1, pageRaw || 1);
  const f: FeedFilters = forceActorId ? { ...filters, aktor: forceActorId } : filters;
  let q = supabase
    .from("audit_logs")
    .select("id, action, actor_id, entity_type, entity_id, created_at, old_value, new_value", { count: "exact" })
    .order("created_at", { ascending: false });
  // Ortak denetim süzgeci (denetim sayfası ve CSV ile aynı); kiracı + aktör koşulu ardından eklenir.
  q = applyAuditFilters(q, { ...f, ara: "" });
  q = q.eq("tenant_id", tenantId).not("actor_id", "is", null);
  const expr = f.kategori ? categoryOrExpr(f.kategori) : null;
  if (expr) q = q.or(expr);
  const offset = (page - 1) * FEED_PAGE_SIZE;
  const { data, count, error } = await q.range(offset, offset + FEED_PAGE_SIZE - 1);
  const total = count ?? 0;
  return {
    rows: (data ?? []) as FeedRow[],
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / FEED_PAGE_SIZE)),
    failed: Boolean(error),
  };
}
