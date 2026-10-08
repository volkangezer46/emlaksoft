import { fetchAllRows, fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaseEndFact, LifecycleFacts, ResaleFact, SellerFact } from "@/lib/insights/rules/lifecycle";
import { LEASE_END_WINDOW_DAYS, SELLER_RECENT_DAYS } from "@/lib/insights/rules/lifecycle";
import { InsightFactsUnavailable, isMissingSchemaError } from "@/lib/insights/facts";

/**
 * lifecycle kuralının olguları. `admin` engine'den gelir (bu dosya istemci OLUŞTURMAZ); HER sorgu AÇIK tenant_id
 * filtreli ve örnek veri (is_sample) dışarıda. Tablolar mevcut çekirdek şemadır (deals, commissions, rentals,
 * customers, customer_demands, properties); `properties.owner_customer_id` yoksa satıcı olgusu boş kalır.
 */

const OPEN_DEMAND = ["new", "active", "matched"];
type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function loadLifecycleFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<LifecycleFacts> {
  const resale: ResaleFact[] = [];
  const leaseEnd: LeaseEndFact[] = [];
  const sellers: SellerFact[] = [];

  // 1) Kazanılmış satışlar (alıcı = deals.customer_id). Yıldönümü penceresi uygulamada süzülür.
  // PostgREST 1000 satır sınırı: tüm kazanılmış satışlar sayfalı okunur (kesilme yok).
  const { data: wonDeals, error: wonError } = await fetchAllRowsKeepError((from, to) =>
    admin
      .from("deals")
      .select("id, customer_id, property_id, assigned_to, updated_at, customer:customers!deals_customer_id_fkey(full_name, assigned_to, is_sample, deleted_at), property:properties!deals_property_id_fkey(title, property_code, owner_customer_id, assigned_to)")
      .eq("tenant_id", tenantId)
      .eq("stage", "won")
      .eq("deal_type", "sale")
      .eq("is_sample", false)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (wonError) {
    if (isMissingSchemaError(wonError)) throw new InsightFactsUnavailable("deals(lifecycle)");
    // owner_customer_id yoksa (eski şema) satıcı bilgisi olmadan tekrar dene
    const retry = await fetchAllRowsKeepError((from, to) =>
      admin
        .from("deals")
        .select("id, customer_id, property_id, assigned_to, updated_at, customer:customers!deals_customer_id_fkey(full_name, assigned_to, is_sample, deleted_at), property:properties!deals_property_id_fkey(title, property_code, assigned_to)")
        .eq("tenant_id", tenantId)
        .eq("stage", "won")
        .eq("deal_type", "sale")
        .eq("is_sample", false)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (retry.error) throw new Error(`deals(lifecycle): ${retry.error.code ?? "hata"}`);
    return { resale: await toResale(admin, tenantId, retry.data ?? []), leaseEnd: await loadLeaseEnds(admin, tenantId, nowMs), sellers };
  }
  const deals = wonDeals ?? [];
  resale.push(...(await toResale(admin, tenantId, deals)));

  // 3) Satıcılar: son SELLER_RECENT_DAYS içinde kazanılan satışların portföy maliki (owner_customer_id).
  const since = nowMs - SELLER_RECENT_DAYS * 86_400_000;
  const sellerRows = deals
    .filter((d) => Date.parse(String(d.updated_at)) >= since)
    .map((d) => ({ d, p: one(d.property as Rel<{ title: string | null; property_code: string | null; owner_customer_id?: string | null; assigned_to: string | null }>) }))
    .filter((x) => x.p?.owner_customer_id);
  if (sellerRows.length > 0) {
    const ownerIds = [...new Set(sellerRows.map((x) => x.p!.owner_customer_id!))];
    const [{ data: owners }, { data: demands }] = await Promise.all([
      admin.from("customers").select("id, full_name, assigned_to").eq("tenant_id", tenantId).eq("is_sample", false).is("deleted_at", null).in("id", ownerIds),
      fetchAllRows((from, to) =>
        admin.from("customer_demands").select("customer_id").eq("tenant_id", tenantId).in("customer_id", ownerIds).in("status", OPEN_DEMAND).order("id", { ascending: true }).range(from, to),
      ),
    ]);
    const ownerById = new Map(((owners ?? []) as { id: string; full_name: string | null; assigned_to: string | null }[]).map((o) => [o.id, o]));
    const withDemand = new Set(((demands ?? []) as { customer_id: string }[]).map((d) => d.customer_id));
    for (const { d, p } of sellerRows) {
      const owner = ownerById.get(p!.owner_customer_id!);
      if (!owner) continue;
      const assignee = owner.assigned_to ?? (d.assigned_to as string | null) ?? p!.assigned_to;
      if (!assignee) continue;
      sellers.push({
        customerId: owner.id,
        customerName: owner.full_name,
        propertyLabel: p!.title ?? p!.property_code,
        assignedTo: assignee,
        soldAt: String(d.updated_at),
        hasOpenDemand: withDemand.has(owner.id),
      });
    }
  }

  leaseEnd.push(...(await loadLeaseEnds(admin, tenantId, nowMs)));
  return { resale, leaseEnd, sellers };
}

type DealRow = {
  id: string;
  customer_id: string | null;
  property_id: string | null;
  assigned_to: string | null;
  updated_at: string;
  customer: unknown;
  property: unknown;
};

async function toResale(admin: SupabaseClient, tenantId: string, rows: readonly DealRow[]): Promise<ResaleFact[]> {
  const candidates = rows.filter((d) => d.customer_id);
  if (candidates.length === 0) return [];
  // Kapanış tarihi: ilk komisyon kaydı (kapanışta otomatik oluşur); yoksa anlaşmanın son güncellemesi.
  const dealIds = candidates.map((d) => d.id).slice(0, 1000);
  const { data: comms } = await fetchAllRows((from, to) =>
    admin
      .from("commissions")
      .select("deal_id, created_at")
      .eq("tenant_id", tenantId)
      .in("deal_id", dealIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const firstComm = new Map<string, string>();
  for (const c of (comms ?? []) as { deal_id: string; created_at: string }[]) if (!firstComm.has(c.deal_id)) firstComm.set(c.deal_id, c.created_at);
  const out: ResaleFact[] = [];
  for (const d of candidates) {
    const customer = one(d.customer as Rel<{ full_name: string | null; assigned_to: string | null; is_sample?: boolean | null; deleted_at?: string | null }>);
    if (!customer || customer.is_sample || customer.deleted_at) continue;
    const property = one(d.property as Rel<{ title: string | null; property_code: string | null }>);
    const assignee = customer.assigned_to ?? d.assigned_to;
    if (!assignee) continue;
    const comm = firstComm.get(d.id);
    out.push({
      dealId: d.id,
      customerId: d.customer_id!,
      customerName: customer.full_name,
      propertyLabel: property?.title ?? property?.property_code ?? null,
      assignedTo: assignee,
      closedAt: comm ?? d.updated_at,
      closedAtSource: comm ? "commission" : "deal_update",
    });
  }
  // Yıldönümü penceresi (3/5 yıl ±15 gün) saf kuralda süzülür.
  return out;
}

async function loadLeaseEnds(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<LeaseEndFact[]> {
  const today = dayKey(nowMs + 3 * 3_600_000);
  const until = dayKey(nowMs + 3 * 3_600_000 + LEASE_END_WINDOW_DAYS * 86_400_000);
  const { data, error } = await fetchAllRows((from, to) =>
    admin
      .from("rentals")
      .select("id, end_date, renter_customer_id, renter:customers!rentals_renter_customer_id_fkey(full_name, assigned_to, is_sample), property:properties!rentals_property_id_fkey(title, property_code, assigned_to, is_sample)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .not("end_date", "is", null)
      .gte("end_date", today)
      .lte("end_date", until)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return [];
  const rows = (data ?? []) as { id: string; end_date: string; renter_customer_id: string; renter: unknown; property: unknown }[];
  if (rows.length === 0) return [];
  const renterIds = [...new Set(rows.map((r) => r.renter_customer_id))];
  const { data: demands } = await fetchAllRows((from, to) =>
    admin
      .from("customer_demands")
      .select("customer_id, transaction_type")
      .eq("tenant_id", tenantId)
      .in("customer_id", renterIds)
      .in("status", OPEN_DEMAND)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const buyers = new Set(
    ((demands ?? []) as { customer_id: string; transaction_type: string | null }[])
      .filter((d) => /sat|sale|buy|al/i.test(String(d.transaction_type ?? "")))
      .map((d) => d.customer_id),
  );
  const out: LeaseEndFact[] = [];
  for (const r of rows) {
    const renter = one(r.renter as Rel<{ full_name: string | null; assigned_to: string | null; is_sample?: boolean | null }>);
    const property = one(r.property as Rel<{ title: string | null; property_code: string | null; assigned_to: string | null; is_sample?: boolean | null }>);
    if (renter?.is_sample || property?.is_sample) continue;
    const assignee = renter?.assigned_to ?? property?.assigned_to ?? null;
    if (!assignee) continue;
    out.push({
      rentalId: r.id,
      renterName: renter?.full_name ?? null,
      propertyLabel: property?.title ?? property?.property_code ?? null,
      assignedTo: assignee,
      endDate: r.end_date,
      hasOpenBuyDemand: buyers.has(r.renter_customer_id),
    });
  }
  return out;
}
