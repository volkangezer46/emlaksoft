"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { now } from "@/lib/clock";

/*
 * Ofisler Arası Ağ (MLS temeli) — TEMKİNLİ mimari.
 *
 * Kiracılar-arası veri paylaşımı bu dosyada ÜÇ kuralla sınırlıdır:
 *  1. OPT-IN: Yalnız tenant'ın kendisinin `network_listings`'e yazdığı
 *     portföyler havuza girer. RLS gevşetilmedi; çapraz okuma yalnız
 *     buradaki service role sorgularıyla olur.
 *  2. MASKELİ DTO: Havuz yanıtı `NetworkPoolItem` alanlarından ibarettir —
 *     malik, iletişim, açık adres, mahalle ASLA çıkmaz (konum ilçe düzeyi).
 *     Ham satırlar client'a hiçbir yoldan sızmaz.
 *  3. İLETİŞİM = KABUL: Karşı ofisin iletişimi yalnız `accepted` durumundaki
 *     taleplerde, ilgili tarafa açılır (getContact* yardımcıları).
 */

export type NetworkResult = { ok?: boolean; error?: string; id?: string };

export type NetworkPoolItem = {
  listingId: string;
  isOwn: boolean;
  title: string;
  transactionType: string;
  propertyType: string;
  rooms: string | null;
  sqm: number | null;
  provinceName: string | null;
  districtName: string | null;
  price: number | null;
  commissionSharePct: number;
  note: string | null;
  officeName: string;
  officeCity: string | null;
  wonDeals: number;
  sharedAt: string;
  /** Ofisimin bu ilana bekleyen/kabul edilmiş talebi var mı (buton kilidi). */
  myRequestStatus: "pending" | "accepted" | null;
};

export type NetworkPoolFilters = {
  provinceId?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
};

export type MyListingRow = {
  id: string;
  status: "active" | "paused";
  commissionSharePct: number;
  note: string | null;
  createdAt: string;
  property: { id: string; title: string | null; code: string; status: string } | null;
  incoming: {
    id: string;
    status: "pending" | "accepted" | "rejected" | "withdrawn";
    message: string | null;
    createdAt: string;
    respondedAt: string | null;
    fromOfficeName: string;
    fromOfficeCity: string | null;
    /** Yalnız accepted taleplerde dolu — talep sahibinin iletişimi. */
    contact: NetworkContact | null;
  }[];
};

export type MyRequestRow = {
  id: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  listing: {
    title: string;
    transactionType: string;
    propertyType: string;
    districtName: string | null;
    provinceName: string | null;
    price: number | null;
    commissionSharePct: number;
  } | null;
  toOfficeName: string;
  toOfficeCity: string | null;
  /** Yalnız accepted taleplerde dolu — karşı ofisin iletişimi. */
  contact: NetworkContact | null;
};

export type NetworkContact = {
  officeName: string;
  personName: string | null;
  phone: string | null;
  email: string | null;
};

const DAILY_REQUEST_LIMIT = 20;

type PropertyFeatures = { rooms?: string | null; sqm?: number | null } & Record<string, unknown>;

function maskProperty(p: {
  title: string | null;
  property_code?: string;
  transaction_type: string;
  property_type: string;
  features: PropertyFeatures | null;
  list_price: number | null;
  province: { name: string } | { name: string }[] | null;
  district: { name: string } | { name: string }[] | null;
}) {
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const features = (p.features ?? {}) as PropertyFeatures;
  const sqmRaw = features.sqm;
  return {
    title: (p.title ?? "").trim() || "İsimsiz portföy",
    transactionType: p.transaction_type,
    propertyType: p.property_type,
    rooms: typeof features.rooms === "string" && features.rooms ? features.rooms : null,
    sqm: typeof sqmRaw === "number" && Number.isFinite(sqmRaw) ? sqmRaw : null,
    provinceName: one(p.province)?.name ?? null,
    districtName: one(p.district)?.name ?? null,
    price: p.list_price,
  };
}

/** Kabul edilmiş taleplerde açılan iletişim kartı. Tenant tablosunda telefon/e-posta
 *  kolonu yok — iletişim, ilgili kaydın `created_by` profilinden (ad + telefon) ve
 *  auth e-postasından derlenir. */
async function buildContact(
  admin: ReturnType<typeof createAdminClient>,
  officeName: string,
  userId: string | null,
): Promise<NetworkContact> {
  if (!userId) return { officeName, personName: null, phone: null, email: null };
  const [{ data: profile }, authRes] = await Promise.all([
    admin.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  return {
    officeName,
    personName: profile?.full_name ?? null,
    phone: profile?.phone ?? null,
    email: authRes.data?.user?.email ?? null,
  };
}

// ============================================================
// Paylaşım yönetimi — yalnız kendi portföyü, RLS'li client
// ============================================================

export async function shareToNetwork(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(fd.get("property_id") ?? "").trim();
  const pctRaw = Number(String(fd.get("commission_share_pct") ?? "").replace(",", "."));
  const note = String(fd.get("note") ?? "").trim() || null;

  if (!propertyId) return { error: "Paylaşılacak portföyü seçin." };
  if (!Number.isFinite(pctRaw) || pctRaw < 0 || pctRaw > 50) {
    return { error: "Komisyon paylaşımı %0–50 aralığında olmalıdır." };
  }

  const supabase = await createClient();

  // Yalnız kendi portföyü + yayında (live) şartı — RLS zaten tenant'a kilitli,
  // yine de tenant_id eşitliğini açık yazıyoruz (savunma katmanı).
  const { data: property } = await supabase
    .from("properties")
    .select("id, status, deleted_at")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property || property.deleted_at) return { error: "Portföy bulunamadı." };
  const st = String(property.status).toLocaleLowerCase("tr-TR");
  if (st !== "live" && st !== "yayında") {
    return { error: "Yalnız yayında (live) durumundaki portföyler ağda paylaşılabilir." };
  }

  // unique(property_id): tekrar paylaşımda mevcut kaydı güncelle + aktifleştir.
  const { data: row, error } = await supabase
    .from("network_listings")
    .upsert(
      {
        tenant_id: gate.tenantId,
        property_id: propertyId,
        commission_share_pct: pctRaw,
        note,
        status: "active",
        created_by: gate.userId,
      },
      { onConflict: "property_id" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("shareToNetwork", error);
    return { error: "Portföy ağda paylaşılamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.share",
    entityType: "network_listing",
    entityId: row.id,
    newValue: { property_id: propertyId, commission_share_pct: pctRaw },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

async function setListingStatus(id: string, status: "active" | "paused"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_listings")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("setListingStatus", error);
    return { error: "Ağ kaydı güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: status === "paused" ? "network.pause" : "network.resume",
    entityType: "network_listing",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function pauseNetworkListing(id: string): Promise<NetworkResult> {
  return setListingStatus(id, "paused");
}

export async function resumeNetworkListing(id: string): Promise<NetworkResult> {
  return setListingStatus(id, "active");
}

export async function removeFromNetwork(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_listings")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("removeFromNetwork", error);
    return { error: "Ağ kaydı kaldırılamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.remove",
    entityType: "network_listing",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

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
// Talepler
// ============================================================

export async function sendCollabRequest(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const listingId = String(fd.get("listing_id") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  if (!listingId) return { error: "İlan bulunamadı." };
  if (!message) return { error: "Karşı ofise kısa bir mesaj yazın." };
  if (message.length > 1000) return { error: "Mesaj en fazla 1000 karakter olabilir." };

  const admin = createAdminClient();

  // İlan başka bir tenant'a ait → doğrulama service role ile (RLS bizi görmez).
  const { data: listing } = await admin
    .from("network_listings")
    .select("id, tenant_id, status")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.status !== "active") return { error: "İlan artık ağda aktif değil." };
  if (listing.tenant_id === gate.tenantId) return { error: "Kendi ilanınıza talep gönderemezsiniz." };

  // Aynı ilana açık (pending/accepted) mükerrer talep engeli.
  const { count: dupCount } = await admin
    .from("network_requests")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId)
    .eq("from_tenant_id", gate.tenantId)
    .in("status", ["pending", "accepted"]);
  if ((dupCount ?? 0) > 0) return { error: "Bu ilana zaten açık bir talebiniz var." };

  // Rate limit: ofis başına günde 20 talep (basit sayım, gün başlangıcı UTC).
  const dayStart = `${new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`;
  const { count: todayCount } = await admin
    .from("network_requests")
    .select("id", { count: "exact", head: true })
    .eq("from_tenant_id", gate.tenantId)
    .gte("created_at", dayStart);
  if ((todayCount ?? 0) >= DAILY_REQUEST_LIMIT) {
    return { error: `Günlük talep sınırına ulaştınız (${DAILY_REQUEST_LIMIT}/gün). Yarın tekrar deneyin.` };
  }

  const { data: row, error } = await admin
    .from("network_requests")
    .insert({
      listing_id: listingId,
      from_tenant_id: gate.tenantId,
      to_tenant_id: listing.tenant_id,
      message,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("sendCollabRequest", error);
    return { error: "Talep gönderilemedi." };
  }

  const { data: myOffice } = await admin.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  await notifyTenant({
    tenantId: listing.tenant_id,
    title: "Ağdan iş birliği talebi",
    body: `${myOffice?.name ?? "Bir ofis"} ağdaki ilanınız için iş birliği talep etti.`,
    href: "/app/ag#paylastiklarim",
    kind: "info",
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.request_sent",
    entityType: "network_request",
    entityId: row.id,
    newValue: { listing_id: listingId },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

export async function respondCollabRequest(id: string, decision: "accept" | "reject"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("network_requests")
    .select("id, listing_id, from_tenant_id, to_tenant_id, status")
    .eq("id", id)
    .eq("to_tenant_id", gate.tenantId) // yalnız kendine gelen talebi yanıtlar
    .maybeSingle();

  if (!request) return { error: "Talep bulunamadı." };
  if (request.status !== "pending") return { error: "Bu talep zaten yanıtlanmış." };

  const status = decision === "accept" ? "accepted" : "rejected";

  // Yanıt to tarafının kendi satır güncellemesi → RLS'li client yeterli
  // (network_requests_respond politikası tam bu geçişe izin verir).
  const supabase = await createClient();
  const { error } = await supabase
    .from("network_requests")
    .update({ status, responded_at: new Date(now()).toISOString() })
    .eq("id", id);

  if (error) {
    console.error("respondCollabRequest", error);
    return { error: "Talep yanıtlanamadı." };
  }

  const { data: offices } = await admin
    .from("tenants")
    .select("id, name")
    .in("id", [request.from_tenant_id, request.to_tenant_id]);
  const nameOf = (tid: string) => (offices ?? []).find((o) => o.id === tid)?.name ?? "Bir ofis";

  if (decision === "accept") {
    // Kabulde HER İKİ tarafa bildirim; iletişim detayları listelerde açılır.
    await Promise.all([
      notifyTenant({
        tenantId: request.from_tenant_id,
        title: "İş birliği talebiniz kabul edildi",
        body: `${nameOf(request.to_tenant_id)} talebinizi kabul etti — iletişim bilgileri Taleplerim bölümünde açıldı.`,
        href: "/app/ag#taleplerim",
        kind: "success",
      }),
      notifyTenant({
        tenantId: request.to_tenant_id,
        title: "İş birliği başlatıldı",
        body: `${nameOf(request.from_tenant_id)} ile iş birliği talebini kabul ettiniz.`,
        href: "/app/ag#paylastiklarim",
        kind: "success",
      }),
    ]);
  } else {
    await notifyTenant({
      tenantId: request.from_tenant_id,
      title: "İş birliği talebi reddedildi",
      body: `${nameOf(request.to_tenant_id)} ağdaki talebinizi reddetti.`,
      href: "/app/ag#taleplerim",
      kind: "warning",
    });
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "accept" ? "network.request_accepted" : "network.request_rejected",
    entityType: "network_request",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function withdrawRequest(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  // from tarafının kendi satırı → RLS'li client (network_requests_withdraw politikası).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("network_requests")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("from_tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("withdrawRequest", error);
    return { error: "Talep geri çekilemedi." };
  }
  if (!data || data.length === 0) return { error: "Yalnız bekleyen talepler geri çekilebilir." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.request_withdrawn",
    entityType: "network_request",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
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

/* ============================================================
 * TALEP HAVUZU (Ağ v1.1) — alıcı taleplerinin ofisler arası paylaşımı
 *
 * Portföy havuzuyla AYNI üç kural + bir ek:
 *  4. MÜŞTERİ ASLA TAŞINMAZ: network_demands yalnız demand_id tutar; havuz
 *     DTO'su talebin KRİTER alanlarından derlenir (tip, il/ilçe, oda) ve
 *     bütçe 100K hassasiyetle yuvarlanmış ARALIK olarak çıkar. Müşteri adı,
 *     iletişim, mahalle, aciliyet ve serbest kriter notu DTO'da yoktur.
 * ============================================================ */

export type NetworkDemandPoolItem = {
  networkDemandId: string;
  isOwn: boolean;
  transactionType: string;
  propertyType: string | null;
  rooms: string | null;
  provinceName: string | null;
  districtName: string | null;
  /** 100K hassasiyetle yuvarlanmış bütçe aralığı (min aşağı, max yukarı). */
  budgetMin: number | null;
  budgetMax: number | null;
  commissionSharePct: number;
  note: string | null;
  officeName: string;
  officeCity: string | null;
  sharedAt: string;
  /** Ofisimin bu talebe bekleyen/kabul edilmiş yanıtı var mı (buton kilidi). */
  myResponseStatus: "pending" | "accepted" | null;
};

/** Talep havuzu filtreleri — URL'de `talep_` önekli paramlardan gelir
 *  (portföy havuzu filtreleriyle çakışmasın diye bölüm bazlı önek). */
export type NetworkDemandPoolFilters = {
  provinceId?: string;
  propertyType?: string;
  /** Bütçe aralığı ÖRTÜŞME mantığı: talebin aralığı verilen aralıkla kesişiyorsa
   *  listelenir; bütçesi belirtilmemiş talepler elenmez. */
  minBudget?: number;
  maxBudget?: number;
};

export type MyNetworkDemandRow = {
  id: string;
  status: "active" | "paused";
  commissionSharePct: number;
  note: string | null;
  createdAt: string;
  /** Kendi talebimin maskesiz özeti (kendi verimiz — müşteri adı yine de taşınmaz). */
  demand: {
    id: string;
    transactionType: string;
    propertyType: string | null;
    rooms: string | null;
    districtName: string | null;
    provinceName: string | null;
    budgetMin: number | null;
    budgetMax: number | null;
    status: string;
  } | null;
  incoming: {
    id: string;
    status: "pending" | "accepted" | "rejected" | "withdrawn";
    propertyHint: string;
    message: string | null;
    createdAt: string;
    respondedAt: string | null;
    fromOfficeName: string;
    fromOfficeCity: string | null;
    /** Yalnız accepted yanıtlarda dolu — öneren ofisin iletişimi. */
    contact: NetworkContact | null;
  }[];
};

export type MyDemandResponseRow = {
  id: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  propertyHint: string;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  /** Yanıtladığım talebin MASKELİ özeti. */
  demand: {
    transactionType: string;
    propertyType: string | null;
    rooms: string | null;
    districtName: string | null;
    provinceName: string | null;
    budgetMin: number | null;
    budgetMax: number | null;
    commissionSharePct: number;
  } | null;
  toOfficeName: string;
  toOfficeCity: string | null;
  /** Yalnız accepted yanıtlarda dolu — talep sahibi ofisin iletişimi. */
  contact: NetworkContact | null;
};

const BUDGET_PRECISION = 100_000;
const OPEN_DEMAND_STATUSES = ["new", "active", "matched"];

/** Bütçe maskesi: 100K hassasiyet — min aşağı, max yukarı yuvarlanır
 *  (gerçek pazarlık payı DTO'dan okunamaz). */
function maskBudget(min: number | null, max: number | null) {
  const floor = (v: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? Math.floor(v / BUDGET_PRECISION) * BUDGET_PRECISION : null;
  const ceil = (v: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? Math.ceil(v / BUDGET_PRECISION) * BUDGET_PRECISION : null;
  return { budgetMin: floor(min), budgetMax: ceil(max) };
}

type DemandJoinRow = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  rooms: string | null;
  budget_min: number | null;
  budget_max: number | null;
  status: string;
  province: { name: string } | { name: string }[] | null;
  district: { name: string } | { name: string }[] | null;
};

/** Talebin MASKELİ DTO'su — müşteri alanına hiç dokunulmaz. */
function maskDemand(d: DemandJoinRow) {
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return {
    transactionType: d.transaction_type,
    propertyType: d.property_type,
    rooms: d.rooms,
    provinceName: one(d.province)?.name ?? null,
    districtName: one(d.district)?.name ?? null,
    ...maskBudget(d.budget_min, d.budget_max),
  };
}

// ============================================================
// Talep paylaşım yönetimi — yalnız kendi talebi, RLS'li client
// ============================================================

export async function shareDemandToNetwork(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const demandId = String(fd.get("demand_id") ?? "").trim();
  const pctRaw = Number(String(fd.get("commission_share_pct") ?? "").replace(",", "."));
  const note = String(fd.get("note") ?? "").trim() || null;

  if (!demandId) return { error: "Paylaşılacak talebi seçin." };
  if (!Number.isFinite(pctRaw) || pctRaw < 0 || pctRaw > 50) {
    return { error: "Komisyon paylaşımı %0–50 aralığında olmalıdır." };
  }

  const supabase = await createClient();

  // Yalnız kendi talebi + açık (new/active/matched) şartı — RLS zaten tenant'a
  // kilitli, tenant_id eşitliği savunma katmanı.
  const { data: demand } = await supabase
    .from("customer_demands")
    .select("id, status")
    .eq("id", demandId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!demand) return { error: "Talep bulunamadı." };
  if (!OPEN_DEMAND_STATUSES.includes(String(demand.status))) {
    return { error: "Yalnız açık durumdaki talepler ağda paylaşılabilir." };
  }

  // unique(demand_id): tekrar paylaşımda mevcut kaydı güncelle + aktifleştir.
  const { data: row, error } = await supabase
    .from("network_demands")
    .upsert(
      {
        tenant_id: gate.tenantId,
        demand_id: demandId,
        commission_share_pct: pctRaw,
        note,
        status: "active",
        created_by: gate.userId,
      },
      { onConflict: "demand_id" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("shareDemandToNetwork", error);
    return { error: "Talep ağda paylaşılamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_share",
    entityType: "network_demand",
    entityId: row.id,
    newValue: { demand_id: demandId, commission_share_pct: pctRaw },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

async function setDemandStatus(id: string, status: "active" | "paused"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_demands")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("setDemandStatus", error);
    return { error: "Ağ talep kaydı güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: status === "paused" ? "network.demand_pause" : "network.demand_resume",
    entityType: "network_demand",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function pauseDemand(id: string): Promise<NetworkResult> {
  return setDemandStatus(id, "paused");
}

export async function resumeDemand(id: string): Promise<NetworkResult> {
  return setDemandStatus(id, "active");
}

export async function removeDemandFromNetwork(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_demands")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("removeDemandFromNetwork", error);
    return { error: "Ağ talep kaydı kaldırılamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_remove",
    entityType: "network_demand",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
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
// Talep yanıtları — "uygun portföyüm var"
// ============================================================

export async function respondToNetworkDemand(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const networkDemandId = String(fd.get("network_demand_id") ?? "").trim();
  const propertyHint = String(fd.get("property_hint") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim() || null;

  if (!networkDemandId) return { error: "Talep bulunamadı." };
  if (!propertyHint) return { error: "Portföy özetini yazın." };
  if (propertyHint.length > 300) return { error: "Portföy özeti en fazla 300 karakter olabilir." };
  if (message && message.length > 1000) return { error: "Mesaj en fazla 1000 karakter olabilir." };

  const admin = createAdminClient();

  // Talep kaydı başka tenant'a ait → doğrulama service role ile.
  const { data: nd } = await admin
    .from("network_demands")
    .select("id, tenant_id, status")
    .eq("id", networkDemandId)
    .maybeSingle();

  if (!nd || nd.status !== "active") return { error: "Talep artık ağda aktif değil." };
  if (nd.tenant_id === gate.tenantId) return { error: "Kendi talebinize yanıt gönderemezsiniz." };

  // Aynı talebe açık (pending/accepted) mükerrer yanıt engeli.
  const { count: dupCount } = await admin
    .from("network_demand_responses")
    .select("id", { count: "exact", head: true })
    .eq("network_demand_id", networkDemandId)
    .eq("from_tenant_id", gate.tenantId)
    .in("status", ["pending", "accepted"]);
  if ((dupCount ?? 0) > 0) return { error: "Bu talebe zaten açık bir yanıtınız var." };

  // Rate limit: ofis başına günde 20 yanıt (portföy tarafıyla aynı desen).
  const dayStart = `${new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`;
  const { count: todayCount } = await admin
    .from("network_demand_responses")
    .select("id", { count: "exact", head: true })
    .eq("from_tenant_id", gate.tenantId)
    .gte("created_at", dayStart);
  if ((todayCount ?? 0) >= DAILY_REQUEST_LIMIT) {
    return { error: `Günlük yanıt sınırına ulaştınız (${DAILY_REQUEST_LIMIT}/gün). Yarın tekrar deneyin.` };
  }

  const { data: row, error } = await admin
    .from("network_demand_responses")
    .insert({
      network_demand_id: networkDemandId,
      from_tenant_id: gate.tenantId,
      to_tenant_id: nd.tenant_id,
      property_hint: propertyHint,
      message,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("respondToNetworkDemand", error);
    return { error: "Yanıt gönderilemedi." };
  }

  const { data: myOffice } = await admin.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  await notifyTenant({
    tenantId: nd.tenant_id,
    title: "Talebinize portföy önerisi geldi",
    body: `${myOffice?.name ?? "Bir ofis"} ağdaki talebiniz için uygun portföyü olduğunu bildirdi.`,
    href: "/app/ag#paylastigim-talepler",
    kind: "info",
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_response_sent",
    entityType: "network_demand_response",
    entityId: row.id,
    newValue: { network_demand_id: networkDemandId },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

async function decideDemandResponse(id: string, decision: "accept" | "reject"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data: response } = await admin
    .from("network_demand_responses")
    .select("id, from_tenant_id, to_tenant_id, status")
    .eq("id", id)
    .eq("to_tenant_id", gate.tenantId) // yalnız kendine gelen yanıtı karara bağlar
    .maybeSingle();

  if (!response) return { error: "Yanıt bulunamadı." };
  if (response.status !== "pending") return { error: "Bu yanıt zaten karara bağlanmış." };

  const status = decision === "accept" ? "accepted" : "rejected";

  // to tarafının kendi satır güncellemesi → RLS'li client yeterli
  // (network_demand_responses_respond politikası tam bu geçişe izin verir).
  const supabase = await createClient();
  const { error } = await supabase
    .from("network_demand_responses")
    .update({ status, responded_at: new Date(now()).toISOString() })
    .eq("id", id);

  if (error) {
    console.error("decideDemandResponse", error);
    return { error: "Yanıt karara bağlanamadı." };
  }

  const { data: offices } = await admin
    .from("tenants")
    .select("id, name")
    .in("id", [response.from_tenant_id, response.to_tenant_id]);
  const nameOf = (tid: string) => (offices ?? []).find((o) => o.id === tid)?.name ?? "Bir ofis";

  if (decision === "accept") {
    // Kabulde HER İKİ tarafa bildirim; iletişim detayları listelerde açılır.
    await Promise.all([
      notifyTenant({
        tenantId: response.from_tenant_id,
        title: "Portföy öneriniz kabul edildi",
        body: `${nameOf(response.to_tenant_id)} önerinizi kabul etti — iletişim bilgileri Talep Yanıtlarım bölümünde açıldı.`,
        href: "/app/ag#talep-yanitlarim",
        kind: "success",
      }),
      notifyTenant({
        tenantId: response.to_tenant_id,
        title: "İş birliği başlatıldı",
        body: `${nameOf(response.from_tenant_id)} ofisinin portföy önerisini kabul ettiniz.`,
        href: "/app/ag#paylastigim-talepler",
        kind: "success",
      }),
    ]);
  } else {
    await notifyTenant({
      tenantId: response.from_tenant_id,
      title: "Portföy öneriniz reddedildi",
      body: `${nameOf(response.to_tenant_id)} ağdaki portföy önerinizi reddetti.`,
      href: "/app/ag#talep-yanitlarim",
      kind: "warning",
    });
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "accept" ? "network.demand_response_accepted" : "network.demand_response_rejected",
    entityType: "network_demand_response",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function acceptDemandResponse(id: string): Promise<NetworkResult> {
  return decideDemandResponse(id, "accept");
}

export async function rejectDemandResponse(id: string): Promise<NetworkResult> {
  return decideDemandResponse(id, "reject");
}

export async function withdrawDemandResponse(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  // from tarafının kendi satırı → RLS'li client (withdraw politikası).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("network_demand_responses")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("from_tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("withdrawDemandResponse", error);
    return { error: "Yanıt geri çekilemedi." };
  }
  if (!data || data.length === 0) return { error: "Yalnız bekleyen yanıtlar geri çekilebilir." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_response_withdrawn",
    entityType: "network_demand_response",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
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

export async function listMyOpenDemands(): Promise<{ id: string; label: string; hint: string }[]> {
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
    };
  });
}

/** "Uygun portföyüm var" dialogu — kendi yayındaki portföyler + hazır MASKELİ
 *  özet ("İlçe · tip · oda · ₺fiyat"). Portföy id'si karşı tarafa GİTMEZ;
 *  yalnız bu serbest metin taşınır. */
export async function listMyPropertiesForHint(): Promise<
  { id: string; label: string; hint: string; maskedSummary: string }[]
> {
  const gate = await requirePermission("network", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select(
      `id, title, property_code, property_type, features, list_price,
       district:geo_districts(name)`,
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
    property_type: string;
    features: PropertyFeatures | null;
    list_price: number | null;
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
    };
  });
}
