import "server-only";
/**
 * Müşteri durumu veri yükleyicisi — okuyucunun (`core.ts`) girdisini TEK yerde toplar.
 * Her ekran aynı RPC'lerden okur; böylece aynı müşteri ekrana göre farklı sıcak/riskli çıkmaz.
 * Sorgular yalnız verilen müşteri id'leri içindir (tenant'ın tamamı çekilmez).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, now } from "@/lib/clock";
import { HEAT_RPC_CHUNK } from "@/lib/customer-list-filters";
import { fetchLeadSignals } from "@/lib/lead-signals";
import { hasListingIntent, isOwnerCustomer } from "@/lib/customer-state/seller";
import {
  buildCustomerState,
  type CustomerState,
  type HeatRpcSignals,
  type LeadRpcSignals,
} from "@/lib/customer-state/core";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { getSetting } from "@/lib/settings/read";

type QueryError = { code?: string; message?: string } | null | undefined;
const ID_CHUNK = 200;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type HeatRpcRow = HeatRpcSignals & { customer_id: string };

/** `customer_heat_signals` — yalnız verilen id'ler (parça parça). Hata değer olarak döner. */
export async function fetchHeatSignals(
  supabase: SupabaseClient,
  tenantId: string | null | undefined,
  customerIds: readonly string[],
): Promise<{ data: HeatRpcRow[]; error: QueryError }> {
  if (!tenantId || customerIds.length === 0) return { data: [], error: null };
  const ids = [...new Set(customerIds)];
  const results = await Promise.all(
    chunked(ids, HEAT_RPC_CHUNK).map((c) => supabase.rpc("customer_heat_signals", { p_tenant_id: tenantId, p_customer_ids: c })),
  );
  const failed = results.find((r) => r.error);
  if (failed) return { data: [], error: failed.error };
  return { data: results.flatMap((r) => (r.data as HeatRpcRow[] | null) ?? []), error: null };
}

/** Gelecekte bekleyen/onaylı randevusu olan müşteri id'leri (verilenler içinden). */
export async function fetchUpcomingAppointmentIds(
  supabase: SupabaseClient,
  customerIds: readonly string[],
  nowIso: string,
): Promise<{ data: Set<string>; error: QueryError }> {
  const out = new Set<string>();
  if (customerIds.length === 0) return { data: out, error: null };
  const results = await Promise.all(
    chunked([...new Set(customerIds)], ID_CHUNK).map((c) =>
      supabase.from("appointments").select("customer_id").in("customer_id", c).gte("scheduled_at", nowIso).in("status", ["pending", "confirmed"]),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed) return { data: out, error: failed.error };
  for (const r of results) for (const a of (r.data ?? []) as { customer_id: string | null }[]) if (a.customer_id) out.add(a.customer_id);
  return { data: out, error: null };
}

export type OwnerHistory = { wonDeals: Map<string, number>; listingIntent: Set<string> };

/** Satıcı-tahmini girdileri (kazanılmış anlaşma + açık satış talebi) — yalnız malik-tipi id'ler için. */
export async function fetchOwnerHistory(
  supabase: SupabaseClient,
  ownerIds: readonly string[],
): Promise<{ data: OwnerHistory; error: QueryError }> {
  const data: OwnerHistory = { wonDeals: new Map(), listingIntent: new Set() };
  if (ownerIds.length === 0) return { data, error: null };
  const parts = chunked([...new Set(ownerIds)], ID_CHUNK);
  const results = await Promise.all(
    parts.flatMap((c) => [
      supabase.from("deals").select("customer_id").in("customer_id", c).eq("stage", "won"),
      supabase.from("customer_demands").select("customer_id, status, transaction_type").in("customer_id", c).in("status", ["new", "active", "matched"]),
    ]),
  );
  const failed = results.find((r) => r.error);
  if (failed) return { data, error: failed.error };
  const demandsBy = new Map<string, { status: string | null; transaction_type: string | null }[]>();
  results.forEach((r, i) => {
    const rows = (r.data ?? []) as { customer_id: string | null; status?: string | null; transaction_type?: string | null }[];
    if (i % 2 === 0) {
      for (const d of rows) if (d.customer_id) data.wonDeals.set(d.customer_id, (data.wonDeals.get(d.customer_id) ?? 0) + 1);
    } else {
      for (const d of rows) {
        if (!d.customer_id) continue;
        const arr = demandsBy.get(d.customer_id) ?? [];
        arr.push({ status: d.status ?? null, transaction_type: d.transaction_type ?? null });
        demandsBy.set(d.customer_id, arr);
      }
    }
  });
  for (const [cid, ds] of demandsBy) if (hasListingIntent(ds)) data.listingIntent.add(cid);
  return { data, error: null };
}

/** Ofis tanımlı uykuda eşiği (office.insight.dormant_days); tanımsızsa undefined → varsayılan. */
export async function loadDormantDays(tenantId: string | null | undefined): Promise<number | undefined> {
  if (!tenantId) return undefined;
  const v = await getSetting<number>("office.insight.dormant_days", { tenantId });
  return typeof v === "number" && v > 0 ? v : undefined;
}

export type StateCustomer = {
  id: string;
  created_at: string;
  blacklist: boolean | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  customer_types: string[] | null;
};

/**
 * Verilen müşteriler için tam durum (ısı + aday + risk + satıcı). Aynı girdi → aynı çıktı:
 * ekranlar bu fonksiyondan (ya da `buildCustomerState`'e aynı girdileri vererek) okur.
 */
export async function loadCustomerStates(
  supabase: SupabaseClient,
  tenantId: string | null | undefined,
  customers: readonly StateCustomer[],
  opts: { nowMs?: number; dormantDays?: number; context?: string } = {},
): Promise<Map<string, CustomerState>> {
  const states = new Map<string, CustomerState>();
  if (customers.length === 0) return states;
  const nowMs = opts.nowMs ?? now();
  const ids = customers.map((c) => c.id);
  const ownerIds = customers.filter((c) => isOwnerCustomer(c.customer_types)).map((c) => c.id);

  const [lead, heat, upcoming, owner, dormantDays] = await Promise.all([
    fetchLeadSignals(supabase, tenantId, ids),
    fetchHeatSignals(supabase, tenantId, ids),
    fetchUpcomingAppointmentIds(supabase, ids, daysAgoIso(0)),
    fetchOwnerHistory(supabase, ownerIds),
    opts.dormantDays !== undefined ? Promise.resolve(opts.dormantDays) : loadDormantDays(tenantId),
  ]);

  // Hata sessizce "veri yok"a dönüşmesin: çağıranın error.tsx sınırına düşer.
  assertQueryBatchSucceeded([lead, heat, upcoming, owner], ["lead-signals", "heat-signals", "upcoming-appointments", "owner-history"], opts.context ?? "Müşteri durumu");

  const leadMap = new Map<string, LeadRpcSignals>(lead.data.map((s) => [s.customer_id, s]));
  const heatMap = new Map<string, HeatRpcRow>(heat.data.map((s) => [s.customer_id, s]));
  for (const c of customers) {
    states.set(
      c.id,
      buildCustomerState(
        {
          customerId: c.id,
          createdAt: c.created_at,
          blacklist: Boolean(c.blacklist),
          hasPhone: Boolean(c.phone),
          hasEmail: Boolean(c.email),
          source: c.source,
          types: c.customer_types ?? [],
          leadSignals: leadMap.get(c.id) ?? null,
          heatSignals: heatMap.get(c.id) ?? null,
          hasUpcomingAppointment: upcoming.data.has(c.id),
          wonDeals: owner.data.wonDeals.get(c.id) ?? 0,
          hasListingIntentDemand: owner.data.listingIntent.has(c.id),
        },
        nowMs,
        { dormantDays },
      ),
    );
  }
  return states;
}
