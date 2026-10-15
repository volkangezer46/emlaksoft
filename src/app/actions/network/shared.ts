import "server-only";

import { OPEN_DEMAND_STATUSES as OPEN_DEMAND_STATUSES_SOURCE } from "@/lib/workflow-state";
import type { createAdminClient } from "@/lib/supabase/admin";

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
 *
 * Dosya düzeni: bu modül (paylaşılan tipler + maske yardımcıları; server action modülü DEĞİL)
 * + listings (portföy paylaşımı) + collab (portföy iş birliği talepleri)
 * + demands (talep paylaşımı/yanıtları) + queries (okuma/listeler).
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

export const DAILY_REQUEST_LIMIT = 20;

export type PropertyFeatures = { rooms?: string | null; sqm?: number | null } & Record<string, unknown>;

export function maskProperty(p: {
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
export async function buildContact(
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

export const BUDGET_PRECISION = 100_000;
// Tek kaynak: workflow-state (sorgularda yayılım için kopya dizi).
export const OPEN_DEMAND_STATUSES: string[] = [...OPEN_DEMAND_STATUSES_SOURCE];

/** Bütçe maskesi: 100K hassasiyet — min aşağı, max yukarı yuvarlanır
 *  (gerçek pazarlık payı DTO'dan okunamaz). */
export function maskBudget(min: number | null, max: number | null) {
  const floor = (v: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? Math.floor(v / BUDGET_PRECISION) * BUDGET_PRECISION : null;
  const ceil = (v: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? Math.ceil(v / BUDGET_PRECISION) * BUDGET_PRECISION : null;
  return { budgetMin: floor(min), budgetMax: ceil(max) };
}

export type DemandJoinRow = {
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
export function maskDemand(d: DemandJoinRow) {
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
