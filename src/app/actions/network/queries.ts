"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import type { MatchDemand, MatchListing } from "@/lib/network/match";
import {
  OPEN_DEMAND_STATUSES,
  buildContact,
  maskDemand,
  maskProperty,
  type DemandJoinRow,
  type MyDemandResponseRow,
  type MyListingRow,
  type MyNetworkDemandRow,
  type MyRequestRow,
  type NetworkDemandPoolFilters,
  type NetworkDemandPoolItem,
  type NetworkPoolFilters,
  type NetworkPoolItem,
  type PropertyFeatures,
} from "./shared";

// ============================================================
// Ağ havuzu — SERVICE ROLE + MASKELİ DTO (tek çapraz okuma noktası)
// ============================================================

export async function listNetworkPool(filters: NetworkPoolFilters = {}): Promise<NetworkPoolItem[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const admin = createAdminClient();

  let query = admin
    .from("network_listings")
    .select(
      `id, tenant_id, commission_share_pct, note, created_at,
       property:properties!inner(
         title, transaction_type, property_type, features, list_price, status, deleted_at, province_id,
         province:geo_provinces(name), district:geo_districts(name)
       ),
       office:tenants!network_listings_tenant_id_fkey(
         name, province:geo_provinces(name)
       )`,
    )
    .eq("status", "active")
    .is("property.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.provinceId) query = query.eq("property.province_id", filters.provinceId);
  if (filters.propertyType) query = query.eq("property.property_type", filters.propertyType);
  if (typeof filters.minPrice === "number") query = query.gte("property.list_price", filters.minPrice);
  if (typeof filters.maxPrice === "number") query = query.lte("property.list_price", filters.maxPrice);

  const { data, error } = await query;
  if (error) {
    console.error("listNetworkPool", error);
    return [];
  }

  type Row = {
    id: string;
    tenant_id: string;
    commission_share_pct: number;
    note: string | null;
    created_at: string;
    property: Parameters<typeof maskProperty>[0] | Parameters<typeof maskProperty>[0][] | null;
    office: { name: string; province: { name: string } | { name: string }[] | null }
      | { name: string; province: { name: string } | { name: string }[] | null }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = (data ?? []) as Row[];

  // Güven göstergesi: ofisin tamamlanmış (won) işlem sayısı — service role,
  // yalnız havuzdaki tenant'lar için toplu tek sorgu.
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  const wonByTenant = new Map<string, number>();
  if (tenantIds.length > 0) {
    const { data: wonRows } = await admin
      .from("deals")
      .select("tenant_id")
      .eq("stage", "won")
      .in("tenant_id", tenantIds)
      .limit(10000);
    for (const d of (wonRows ?? []) as { tenant_id: string }[]) {
      wonByTenant.set(d.tenant_id, (wonByTenant.get(d.tenant_id) ?? 0) + 1);
    }
  }

  // Buton kilidi: ofisimin bekleyen/kabul edilmiş talebi olan ilanlar.
  const myRequestByListing = new Map<string, "pending" | "accepted">();
  if (rows.length > 0) {
    const { data: myReqs } = await admin
      .from("network_requests")
      .select("listing_id, status")
      .eq("from_tenant_id", gate.tenantId)
      .in("status", ["pending", "accepted"])
      .in("listing_id", rows.map((r) => r.id));
    for (const r of (myReqs ?? []) as { listing_id: string; status: "pending" | "accepted" }[]) {
      myRequestByListing.set(r.listing_id, r.status);
    }
  }

  return rows.flatMap((row) => {
    const property = one(row.property);
    const office = one(row.office);
    if (!property || !office) return [];
    const masked = maskProperty(property);
    return [
      {
        listingId: row.id,
        isOwn: row.tenant_id === gate.tenantId,
        ...masked,
        commissionSharePct: Number(row.commission_share_pct),
        note: row.note,
        officeName: office.name,
        officeCity: one(office.province)?.name ?? null,
        wonDeals: wonByTenant.get(row.tenant_id) ?? 0,
        sharedAt: row.created_at,
        myRequestStatus: myRequestByListing.get(row.id) ?? null,
      } satisfies NetworkPoolItem,
    ];
  });
}

// ============================================================
// Listeler — Paylaştıklarım / Taleplerim
// ============================================================

export async function listMyNetworkListings(): Promise<MyListingRow[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("network_listings")
    .select(
      `id, status, commission_share_pct, note, created_at,
       property:properties(id, title, property_code, status),
       requests:network_requests(id, status, message, created_at, responded_at, from_tenant_id, created_by)`,
    )
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listMyNetworkListings", error);
    return [];
  }

  type ReqRow = {
    id: string;
    status: MyListingRow["incoming"][number]["status"];
    message: string | null;
    created_at: string;
    responded_at: string | null;
    from_tenant_id: string;
    created_by: string | null;
  };
  type Row = {
    id: string;
    status: "active" | "paused";
    commission_share_pct: number;
    note: string | null;
    created_at: string;
    property: { id: string; title: string | null; property_code: string; status: string }
      | { id: string; title: string | null; property_code: string; status: string }[]
      | null;
    requests: ReqRow[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = (data ?? []) as Row[];

  // Karşı ofis adları + kabul edilen taleplerin iletişimi — service role
  // (tenants tablosunu çapraz okumak RLS'ten geçmez; maskeli alan seti sabit).
  const admin = createAdminClient();
  const fromTenantIds = [...new Set(rows.flatMap((r) => (r.requests ?? []).map((q) => q.from_tenant_id)))];
  const officeById = new Map<string, { name: string; city: string | null }>();
  if (fromTenantIds.length > 0) {
    const { data: offices } = await admin
      .from("tenants")
      .select("id, name, province:geo_provinces(name)")
      .in("id", fromTenantIds);
    for (const o of (offices ?? []) as { id: string; name: string; province: { name: string } | { name: string }[] | null }[]) {
      officeById.set(o.id, { name: o.name, city: one(o.province)?.name ?? null });
    }
  }

  return Promise.all(
    rows.map(async (row) => {
      const property = one(row.property);
      const incoming = await Promise.all(
        (row.requests ?? [])
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map(async (q) => {
            const office = officeById.get(q.from_tenant_id) ?? { name: "Bilinmeyen ofis", city: null };
            return {
              id: q.id,
              status: q.status,
              message: q.message,
              createdAt: q.created_at,
              respondedAt: q.responded_at,
              fromOfficeName: office.name,
              fromOfficeCity: office.city,
              contact: q.status === "accepted" ? await buildContact(admin, office.name, q.created_by) : null,
            };
          }),
      );
      return {
        id: row.id,
        status: row.status,
        commissionSharePct: Number(row.commission_share_pct),
        note: row.note,
        createdAt: row.created_at,
        property: property
          ? { id: property.id, title: property.title, code: property.property_code, status: property.status }
          : null,
        incoming,
      } satisfies MyListingRow;
    }),
  );
}

export async function listMyRequests(): Promise<MyRequestRow[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  // Talep satırları kendi tarafımız (RLS select geçer) ama ilanın portföyü ve
  // karşı ofis başka tenant'ta → tamamı service role ile, maskeli derlenir.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("network_requests")
    .select(
      `id, status, message, created_at, responded_at, to_tenant_id,
       listing:network_listings(
         commission_share_pct, created_by,
         property:properties(
           title, transaction_type, property_type, features, list_price,
           province:geo_provinces(name), district:geo_districts(name)
         )
       ),
       office:tenants!network_requests_to_tenant_id_fkey(name, province:geo_provinces(name))`,
    )
    .eq("from_tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listMyRequests", error);
    return [];
  }

  type Row = {
    id: string;
    status: MyRequestRow["status"];
    message: string | null;
    created_at: string;
    responded_at: string | null;
    to_tenant_id: string;
    listing:
      | {
          commission_share_pct: number;
          created_by: string | null;
          property: Parameters<typeof maskProperty>[0] | Parameters<typeof maskProperty>[0][] | null;
        }
      | {
          commission_share_pct: number;
          created_by: string | null;
          property: Parameters<typeof maskProperty>[0] | Parameters<typeof maskProperty>[0][] | null;
        }[]
      | null;
    office: { name: string; province: { name: string } | { name: string }[] | null }
      | { name: string; province: { name: string } | { name: string }[] | null }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = (data ?? []) as Row[];

  return Promise.all(
    rows.map(async (row) => {
      const listing = one(row.listing);
      const property = listing ? one(listing.property) : null;
      const office = one(row.office);
      const officeName = office?.name ?? "Bilinmeyen ofis";
      const masked = property ? maskProperty(property) : null;
      return {
        id: row.id,
        status: row.status,
        message: row.message,
        createdAt: row.created_at,
        respondedAt: row.responded_at,
        listing:
          listing && masked
            ? {
                title: masked.title,
                transactionType: masked.transactionType,
                propertyType: masked.propertyType,
                districtName: masked.districtName,
                provinceName: masked.provinceName,
                price: masked.price,
                commissionSharePct: Number(listing.commission_share_pct),
              }
            : null,
        toOfficeName: officeName,
        toOfficeCity: one(office?.province ?? null)?.name ?? null,
        contact:
          row.status === "accepted" && listing
            ? await buildContact(admin, officeName, listing.created_by)
            : null,
      } satisfies MyRequestRow;
    }),
  );
}

// ============================================================
// Paylaşım dialogu için kendi yayındaki portföyler
// ============================================================

export async function listMyLiveProperties(): Promise<{ id: string; label: string; hint: string }[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, title, property_code, status, district:geo_districts(name)")
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .in("status", ["live", "Yayında", "yayında"])
    .order("created_at", { ascending: false })
    .limit(300);

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return ((data ?? []) as {
    id: string;
    title: string | null;
    property_code: string;
    district: { name: string } | { name: string }[] | null;
  }[]).map((p) => ({
    id: p.id,
    label: (p.title ?? "").trim() || p.property_code,
    hint: [p.property_code, one(p.district)?.name].filter(Boolean).join(" · "),
  }));
}

// ============================================================
// Talep havuzu — SERVICE ROLE + MASKELİ DTO (tek çapraz okuma noktası)
// ============================================================

export async function listNetworkDemandPool(
  filters: NetworkDemandPoolFilters = {},
): Promise<NetworkDemandPoolItem[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const admin = createAdminClient();
  let query = admin
    .from("network_demands")
    .select(
      `id, tenant_id, commission_share_pct, note, created_at,
       demand:customer_demands!inner(
         id, transaction_type, property_type, rooms, budget_min, budget_max, status,
         province:geo_provinces(name), district:geo_districts(name)
       ),
       office:tenants!network_demands_tenant_id_fkey(
         name, province:geo_provinces(name)
       )`,
    )
    .eq("status", "active")
    .in("demand.status", OPEN_DEMAND_STATUSES)
    .order("created_at", { ascending: false })
    .limit(200);

  // Sunucu taraflı filtreler — !inner join sayesinde talep satırı elenirse
  // havuz kaydı da düşer (portföy havuzundaki listNetworkPool deseni).
  if (filters.provinceId) query = query.eq("demand.province_id", filters.provinceId);
  if (filters.propertyType) query = query.eq("demand.property_type", filters.propertyType);
  // Bütçe örtüşmesi: min filtresi talebin üst sınırına, max filtresi alt
  // sınırına bakar; sınırı belirtilmemiş (null) talepler elenmez.
  if (typeof filters.minBudget === "number") {
    query = query.or(`budget_max.gte.${filters.minBudget},budget_max.is.null`, { referencedTable: "demand" });
  }
  if (typeof filters.maxBudget === "number") {
    query = query.or(`budget_min.lte.${filters.maxBudget},budget_min.is.null`, { referencedTable: "demand" });
  }

  const { data, error } = await query;
  if (error) {
    console.error("listNetworkDemandPool", error);
    return [];
  }

  type Row = {
    id: string;
    tenant_id: string;
    commission_share_pct: number;
    note: string | null;
    created_at: string;
    demand: DemandJoinRow | DemandJoinRow[] | null;
    office: { name: string; province: { name: string } | { name: string }[] | null }
      | { name: string; province: { name: string } | { name: string }[] | null }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = (data ?? []) as Row[];

  // Buton kilidi: ofisimin bekleyen/kabul edilmiş yanıtı olan talepler.
  const myResponseByDemand = new Map<string, "pending" | "accepted">();
  if (rows.length > 0) {
    const { data: myResps } = await admin
      .from("network_demand_responses")
      .select("network_demand_id, status")
      .eq("from_tenant_id", gate.tenantId)
      .in("status", ["pending", "accepted"])
      .in("network_demand_id", rows.map((r) => r.id));
    for (const r of (myResps ?? []) as { network_demand_id: string; status: "pending" | "accepted" }[]) {
      myResponseByDemand.set(r.network_demand_id, r.status);
    }
  }

  return rows.flatMap((row) => {
    const demand = one(row.demand);
    const office = one(row.office);
    if (!demand || !office) return [];
    return [
      {
        networkDemandId: row.id,
        isOwn: row.tenant_id === gate.tenantId,
        ...maskDemand(demand),
        commissionSharePct: Number(row.commission_share_pct),
        note: row.note,
        officeName: office.name,
        officeCity: one(office.province)?.name ?? null,
        sharedAt: row.created_at,
        myResponseStatus: myResponseByDemand.get(row.id) ?? null,
      } satisfies NetworkDemandPoolItem,
    ];
  });
}

// ============================================================
// Listeler — Paylaştığım Talepler / Talep Yanıtlarım
// ============================================================

export async function listMyNetworkDemands(): Promise<MyNetworkDemandRow[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("network_demands")
    .select(
      `id, status, commission_share_pct, note, created_at,
       demand:customer_demands(
         id, transaction_type, property_type, rooms, budget_min, budget_max, status,
         province:geo_provinces(name), district:geo_districts(name)
       ),
       responses:network_demand_responses(
         id, status, property_hint, message, created_at, responded_at, from_tenant_id, created_by
       )`,
    )
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listMyNetworkDemands", error);
    return [];
  }

  type RespRow = {
    id: string;
    status: MyNetworkDemandRow["incoming"][number]["status"];
    property_hint: string;
    message: string | null;
    created_at: string;
    responded_at: string | null;
    from_tenant_id: string;
    created_by: string | null;
  };
  type Row = {
    id: string;
    status: "active" | "paused";
    commission_share_pct: number;
    note: string | null;
    created_at: string;
    demand: DemandJoinRow | DemandJoinRow[] | null;
    responses: RespRow[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = (data ?? []) as Row[];

  // Karşı ofis adları + kabul edilen yanıtların iletişimi — service role
  // (tenants tablosunu çapraz okumak RLS'ten geçmez; maskeli alan seti sabit).
  const admin = createAdminClient();
  const fromTenantIds = [...new Set(rows.flatMap((r) => (r.responses ?? []).map((q) => q.from_tenant_id)))];
  const officeById = new Map<string, { name: string; city: string | null }>();
  if (fromTenantIds.length > 0) {
    const { data: offices } = await admin
      .from("tenants")
      .select("id, name, province:geo_provinces(name)")
      .in("id", fromTenantIds);
    for (const o of (offices ?? []) as { id: string; name: string; province: { name: string } | { name: string }[] | null }[]) {
      officeById.set(o.id, { name: o.name, city: one(o.province)?.name ?? null });
    }
  }

  return Promise.all(
    rows.map(async (row) => {
      const demand = one(row.demand);
      const incoming = await Promise.all(
        (row.responses ?? [])
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map(async (q) => {
            const office = officeById.get(q.from_tenant_id) ?? { name: "Bilinmeyen ofis", city: null };
            return {
              id: q.id,
              status: q.status,
              propertyHint: q.property_hint,
              message: q.message,
              createdAt: q.created_at,
              respondedAt: q.responded_at,
              fromOfficeName: office.name,
              fromOfficeCity: office.city,
              contact: q.status === "accepted" ? await buildContact(admin, office.name, q.created_by) : null,
            };
          }),
      );
      return {
        id: row.id,
        status: row.status,
        commissionSharePct: Number(row.commission_share_pct),
        note: row.note,
        createdAt: row.created_at,
        demand: demand
          ? {
              id: demand.id,
              transactionType: demand.transaction_type,
              propertyType: demand.property_type,
              rooms: demand.rooms,
              districtName: one(demand.district)?.name ?? null,
              provinceName: one(demand.province)?.name ?? null,
              budgetMin: demand.budget_min,
              budgetMax: demand.budget_max,
              status: demand.status,
            }
          : null,
        incoming,
      } satisfies MyNetworkDemandRow;
    }),
  );
}

export async function listMyDemandResponses(): Promise<MyDemandResponseRow[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  // Yanıt satırları kendi tarafımız ama talebin kaynağı ve karşı ofis başka
  // tenant'ta → tamamı service role ile, MASKELİ derlenir (müşteri asla).
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("network_demand_responses")
    .select(
      `id, status, property_hint, message, created_at, responded_at, to_tenant_id,
       network_demand:network_demands(
         commission_share_pct, created_by,
         demand:customer_demands(
           id, transaction_type, property_type, rooms, budget_min, budget_max, status,
           province:geo_provinces(name), district:geo_districts(name)
         )
       ),
       office:tenants!network_demand_responses_to_tenant_id_fkey(name, province:geo_provinces(name))`,
    )
    .eq("from_tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listMyDemandResponses", error);
    return [];
  }

  type NdRow = {
    commission_share_pct: number;
    created_by: string | null;
    demand: DemandJoinRow | DemandJoinRow[] | null;
  };
  type Row = {
    id: string;
    status: MyDemandResponseRow["status"];
    property_hint: string;
    message: string | null;
    created_at: string;
    responded_at: string | null;
    to_tenant_id: string;
    network_demand: NdRow | NdRow[] | null;
    office: { name: string; province: { name: string } | { name: string }[] | null }
      | { name: string; province: { name: string } | { name: string }[] | null }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = (data ?? []) as Row[];

  return Promise.all(
    rows.map(async (row) => {
      const nd = one(row.network_demand);
      const demand = nd ? one(nd.demand) : null;
      const office = one(row.office);
      const officeName = office?.name ?? "Bilinmeyen ofis";
      return {
        id: row.id,
        status: row.status,
        propertyHint: row.property_hint,
        message: row.message,
        createdAt: row.created_at,
        respondedAt: row.responded_at,
        demand:
          nd && demand
            ? {
                ...maskDemand(demand),
                commissionSharePct: Number(nd.commission_share_pct),
              }
            : null,
        toOfficeName: officeName,
        toOfficeCity: one(office?.province ?? null)?.name ?? null,
        contact:
          row.status === "accepted" && nd
            ? await buildContact(admin, officeName, nd.created_by)
            : null,
      } satisfies MyDemandResponseRow;
    }),
  );
}

// ============================================================
// Dialog kaynakları — açık taleplerim / önerilecek portföylerim
// ============================================================

export async function listMyOpenDemands(): Promise<{ id: string; label: string; hint: string; criteria: MatchDemand }[]> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_demands")
    .select(
      `id, transaction_type, property_type, rooms, budget_min, budget_max,
       province:geo_provinces(name), district:geo_districts(name)`,
    )
    .eq("tenant_id", gate.tenantId)
    .in("status", OPEN_DEMAND_STATUSES)
    .order("created_at", { ascending: false })
    .limit(300);

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const fmt = (v: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? `₺${Math.round(v).toLocaleString("tr-TR")}` : null;
  return ((data ?? []) as DemandJoinRow[]).map((d) => {
    const budget =
      d.budget_min != null || d.budget_max != null
        ? [fmt(d.budget_min) ?? "?", fmt(d.budget_max) ?? "?"].join(" – ")
        : null;
    return {
      id: d.id,
      // Müşteri adı bilinçli olarak YOK — talep, kriterleriyle anılır.
      label: [d.transaction_type, d.property_type, d.rooms].filter(Boolean).join(" · ") || "Talep",
      hint: [one(d.district)?.name ?? one(d.province)?.name, budget].filter(Boolean).join(" · "),
      // Ağ eşleştirmesi (OA10) için ölçütler: yalnız kendi ofisimin talebi, istemciye zaten giden alanlar.
      criteria: {
        transactionType: d.transaction_type,
        propertyType: d.property_type,
        rooms: d.rooms,
        provinceName: one(d.province)?.name ?? null,
        districtName: one(d.district)?.name ?? null,
        budgetMin: d.budget_min,
        budgetMax: d.budget_max,
      },
    };
  });
}

/** "Uygun portföyüm var" dialogu — kendi yayındaki portföyler + hazır MASKELİ
 *  özet ("İlçe · tip · oda · ₺fiyat"). Portföy id'si karşı tarafa GİTMEZ;
 *  yalnız bu serbest metin taşınır. */
export async function listMyPropertiesForHint(): Promise<
  { id: string; label: string; hint: string; maskedSummary: string; criteria: MatchListing }[]
> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select(
      `id, title, property_code, transaction_type, property_type, features, list_price,
       province:geo_provinces(name), district:geo_districts(name)`,
    )
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .in("status", ["live", "Yayında", "yayında"])
    .order("created_at", { ascending: false })
    .limit(300);

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return ((data ?? []) as {
    id: string;
    title: string | null;
    property_code: string;
    transaction_type: string | null;
    property_type: string;
    features: PropertyFeatures | null;
    list_price: number | null;
    province: { name: string } | { name: string }[] | null;
    district: { name: string } | { name: string }[] | null;
  }[]).map((p) => {
    const rooms = typeof p.features?.rooms === "string" && p.features.rooms ? p.features.rooms : null;
    const price =
      typeof p.list_price === "number" && Number.isFinite(p.list_price)
        ? `₺${Math.round(p.list_price).toLocaleString("tr-TR")}`
        : null;
    return {
      id: p.id,
      label: (p.title ?? "").trim() || p.property_code,
      hint: [p.property_code, one(p.district)?.name].filter(Boolean).join(" · "),
      maskedSummary: [one(p.district)?.name, p.property_type, rooms, price].filter(Boolean).join(" · "),
      criteria: {
        transactionType: p.transaction_type,
        propertyType: p.property_type,
        rooms,
        provinceName: one(p.province)?.name ?? null,
        districtName: one(p.district)?.name ?? null,
        price: typeof p.list_price === "number" && Number.isFinite(p.list_price) ? p.list_price : null,
      },
    };
  });
}
