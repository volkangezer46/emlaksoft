import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROPERTY_REASON_LABEL,
  demandsSimilar,
  emailLookupKey,
  phoneLookupVariants,
  propertyMatchReasons,
  scopeHit,
  type DuplicateHit,
  type PropertyProbe,
} from "@/lib/duplicate-match";

/**
 * Mükerrer arama sorguları (salt-okunur). Kullanıcı oturumlu client ile çalışır (RLS + açık tenant filtresi);
 * kapsam dışı satırlar `scopeHit` ile maskelenir. İndeks: customers(tenant_id, phone) VAR;
 * e-posta için (tenant_id, email) indeksi YOK (küçük tenant'ta sorun değil; büyürse migration önerilir).
 */

export type Viewer = { userId: string; officeWide: boolean };

const MAX_HITS = 3;

const EMPTY_HIT: DuplicateHit = {
  id: null, visible: true, label: null, advisor: null, lastContact: null,
  code: null, price: null, status: null, reasons: [],
};

async function advisorNames(supabase: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", ids);
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) out.set(p.id, p.full_name ?? "");
  return out;
}

type CustomerRow = { id: string; full_name: string; phone: string | null; email: string | null; assigned_to: string | null; created_by: string | null };

export async function findCustomerDuplicates(
  supabase: SupabaseClient,
  args: { tenantId: string; phone: string; email: string; excludeId?: string },
  viewer: Viewer,
): Promise<DuplicateHit[]> {
  const variants = phoneLookupVariants(args.phone);
  const email = emailLookupKey(args.email);
  if (variants.length === 0 && !email) return [];

  const found = new Map<string, { row: CustomerRow; reasons: Set<string> }>();
  const add = (rows: CustomerRow[] | null, reason: string) => {
    for (const r of rows ?? []) {
      if (args.excludeId && r.id === args.excludeId) continue;
      const e = found.get(r.id) ?? { row: r, reasons: new Set<string>() };
      e.reasons.add(reason);
      found.set(r.id, e);
    }
  };
  const cols = "id, full_name, phone, email, assigned_to, created_by";
  if (variants.length > 0) {
    const { data } = await supabase
      .from("customers")
      .select(cols)
      .eq("tenant_id", args.tenantId)
      .is("deleted_at", null)
      .in("phone", variants)
      .limit(10);
    add(data as CustomerRow[] | null, "telefon");
  }
  if (email) {
    const { data } = await supabase
      .from("customers")
      .select(cols)
      .eq("tenant_id", args.tenantId)
      .is("deleted_at", null)
      .eq("email", email)
      .limit(10);
    add(data as CustomerRow[] | null, "e-posta");
  }
  const entries = [...found.values()].slice(0, MAX_HITS);
  if (entries.length === 0) return [];

  const visibleIds = entries
    .filter((e) => viewer.officeWide || e.row.assigned_to === viewer.userId)
    .map((e) => e.row.id);
  const advisors = await advisorNames(
    supabase,
    args.tenantId,
    [...new Set(entries.filter((e) => visibleIds.includes(e.row.id)).map((e) => e.row.assigned_to).filter((v): v is string => !!v))],
  );
  const lastContact = new Map<string, string | null>();
  if (visibleIds.length > 0) {
    try {
      const { data } = await supabase.rpc("customer_heat_signals", { p_tenant_id: args.tenantId, p_customer_ids: visibleIds });
      for (const s of (data ?? []) as { customer_id: string; last_contact: string | null }[]) {
        lastContact.set(s.customer_id, s.last_contact);
      }
    } catch {
      // son temas bilgisi isteğe bağlı
    }
  }

  return entries.map(({ row, reasons }) => {
    // Gizlilik: ayrıntı yalnız ofis geneli kapsam ya da KENDİNE ATANMIŞ kayıtta açılır (created_by yetmez).
    const owner = row.assigned_to;
    return scopeHit(
      {
        ...EMPTY_HIT,
        id: row.id,
        label: row.full_name,
        advisor: row.assigned_to ? (advisors.get(row.assigned_to) ?? null) : null,
        lastContact: lastContact.get(row.id) ?? null,
        reasons: [...reasons],
      },
      owner,
      viewer,
    );
  });
}

type PropertyRow = {
  id: string; property_code: string; title: string | null; address_line: string | null;
  parcel_block: string | null; parcel_lot: string | null; property_type: string | null;
  transaction_type: string | null; district_id: string | null; neighborhood_id: string | null;
  list_price: number | null; status: string | null; assigned_to: string | null;
};

export async function findPropertyDuplicates(
  supabase: SupabaseClient,
  args: { tenantId: string; probe: PropertyProbe },
  viewer: Viewer,
): Promise<DuplicateHit[]> {
  const { probe } = args;
  // Konum bağlamı yoksa (mahalle/ilçe seçilmemiş) eşleşme güvenilmez; sorgu boşa gitmesin.
  if (!probe.neighborhoodId && !probe.districtId) return [];
  let q = supabase
    .from("properties")
    .select(
      "id, property_code, title, address_line, parcel_block, parcel_lot, property_type, transaction_type, district_id, neighborhood_id, list_price, status, assigned_to",
    )
    .eq("tenant_id", args.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  q = probe.neighborhoodId ? q.eq("neighborhood_id", probe.neighborhoodId) : q.eq("district_id", probe.districtId);
  const { data } = await q;

  const hits: { row: PropertyRow; reasons: string[] }[] = [];
  for (const row of (data ?? []) as PropertyRow[]) {
    const reasons = propertyMatchReasons(probe, row).map((r) => PROPERTY_REASON_LABEL[r]);
    if (reasons.length > 0) hits.push({ row, reasons });
    if (hits.length >= MAX_HITS) break;
  }
  const advisors = await advisorNames(
    supabase,
    args.tenantId,
    [...new Set(hits.map((h) => h.row.assigned_to).filter((v): v is string => !!v))],
  );
  return hits.map(({ row, reasons }) =>
    scopeHit(
      {
        ...EMPTY_HIT,
        id: row.id,
        label: row.title,
        advisor: row.assigned_to ? (advisors.get(row.assigned_to) ?? null) : null,
        code: row.property_code,
        price: row.list_price != null ? Number(row.list_price) : null,
        status: row.status,
        reasons,
      },
      row.assigned_to,
      viewer,
    ),
  );
}

export async function findSimilarOpenDemands(
  supabase: SupabaseClient,
  args: { tenantId: string; customerId: string; transactionType: string; propertyType: string; districtId: string },
  viewer: Viewer,
): Promise<DuplicateHit[]> {
  if (!args.customerId || !args.transactionType) return [];
  const { data: cust } = await supabase
    .from("customers")
    .select("assigned_to, created_by")
    .eq("id", args.customerId)
    .eq("tenant_id", args.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cust) return [];
  const { data } = await supabase
    .from("customer_demands")
    .select("id, transaction_type, property_type, district_id, status, created_at")
    .eq("tenant_id", args.tenantId)
    .eq("customer_id", args.customerId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);
  const owner = cust.assigned_to as string | null;
  const rows = ((data ?? []) as { id: string; transaction_type: string | null; property_type: string | null; district_id: string | null }[]).filter(
    (r) => demandsSimilar(args, r),
  );
  return rows.slice(0, MAX_HITS).map((r) =>
    scopeHit(
      {
        ...EMPTY_HIT,
        id: r.id,
        label: [r.transaction_type, r.property_type].filter(Boolean).join(" · ") || "Açık talep",
        reasons: ["açık talep"],
      },
      owner,
      viewer,
    ),
  );
}
