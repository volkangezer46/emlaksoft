"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { orIlike } from "@/lib/pgrst";
import type { ComboboxOption } from "@/components/ui/combobox";

/**
 * Seçici kutuları için sunucu taraflı arama.
 *
 * NEDEN GEREKLİ: Randevu/anlaşma/görev diyaloglarına müşteri ve portföy
 * listeleri sayfa yüklenirken `.limit(100)` / `.limit(200)` ile geliyordu.
 * Arama kutusu "tüm müşterilerde ara" izlenimi veriyordu ama yalnızca o ilk
 * 100 kaydı tarıyordu — 500 müşterisi olan bir ofiste eski bir müşteriyi bu
 * diyalogdan seçmek İMKÂNSIZDI. Sorun native `<select>`te de vardı, sadece
 * daha az göze batıyordu.
 *
 * Burada arama veritabanına iniyor; ilk liste yalnızca "son eklenenler"
 * kısayolu olarak kalıyor.
 *
 * YETKİ: Kullanıcı oturumlu istemci kullanılıyor, yani RLS kiracı ayrımını
 * kendisi yapıyor. `tenant_id` filtresi elle eklenmiyor — RLS'i atlatabilecek
 * service_role burada hiç devrede değil.
 */

const MIN_QUERY = 2;
const LIMIT = 25;

export async function searchCustomers(query: string): Promise<ComboboxOption[]> {
  // Yetki kapisi: RLS kiraci ayrimini yapiyor ama MODUL izni ayri bir sey —
  // musteri modulune erisimi olmayan bir kullanici (or. yalnizca portfoy
  // goren bir rol) bu uctan musteri adi ve telefonu toplayabilirdi.
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return [];

  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .is("deleted_at", null)
    .or(orIlike(["full_name", "phone", "email"], q))
    .order("full_name")
    .limit(LIMIT);

  if (error || !data) return [];
  return data.map((c) => ({
    value: c.id,
    label: c.full_name ?? "İsimsiz",
    hint: c.phone ?? undefined,
  }));
}

export async function searchProperties(query: string): Promise<ComboboxOption[]> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, property_code, title")
    .is("deleted_at", null)
    .or(orIlike(["property_code", "title", "address_line"], q))
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error || !data) return [];
  return data.map((p) => ({
    value: p.id,
    label: p.title ?? "Başlıksız",
    hint: p.property_code,
  }));
}

/** Teklif formu: seçilen portföyün liste fiyatı özetinin çekirdeği (tek kayıt, RLS süzgeçli). */
export type PropertyPriceSummary = {
  id: string;
  property_code: string;
  title: string | null;
  list_price: number | null;
};

/**
 * Teklif formu portföy araması: yalnız teklif alınabilir durumdaki portföyler
 * (taslak/yayında/opsiyonlu). `searchProperties`'ten farkı liste fiyatını da
 * döndürmesidir — teklif tutarı ön dolgusu ve "liste fiyatına oran" özeti için.
 */
export async function searchOfferProperties(query: string): Promise<PropertyPriceSummary[]> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, property_code, title, list_price")
    .is("deleted_at", null)
    .in("status", ["live", "draft", "reserved"])
    .or(orIlike(["property_code", "title", "address_line"], q))
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error || !data) return [];
  return data.map((p) => ({
    id: p.id as string,
    property_code: p.property_code as string,
    title: (p.title as string | null) ?? null,
    list_price: p.list_price != null ? Number(p.list_price) : null,
  }));
}

/** Tek portföyün fiyat özeti (seçim sonrası ön dolgu). Yetkisiz/yok ise null. */
export async function getPropertyPriceSummary(id: string): Promise<PropertyPriceSummary | null> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, property_code, title, list_price")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    property_code: data.property_code as string,
    title: (data.title as string | null) ?? null,
    list_price: data.list_price != null ? Number(data.list_price) : null,
  };
}

/** Sunum formu: yayındaki portföy seçeneği (arama sonucu). */
export type PresentationPropertyPick = {
  id: string;
  code: string;
  title: string | null;
  price: number | null;
  tx: string;
  district: string | null;
};

/**
 * Sunum formu portföy araması: yalnız yayındaki portföyler (sunum action'ı da
 * aynı kuralı zorlar). Boş sorgu "son yayına alınanlar" kısayolunu döndürür;
 * aksi halde arama veritabanına iner (eski 300'lük istemci havuzu yok).
 */
export async function searchLivePropertiesForPresentation(
  query: string,
): Promise<PresentationPropertyPick[]> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const q = query.trim();
  const supabase = await createClient();
  let req = supabase
    .from("properties")
    .select("id, property_code, title, list_price, transaction_type, district:geo_districts(name)")
    .in("status", ["live", "Yayında"])
    .is("deleted_at", null);
  if (q.length >= MIN_QUERY) req = req.or(orIlike(["property_code", "title", "address_line"], q));
  else if (q.length > 0) return [];
  const { data, error } = await req.order("created_at", { ascending: false }).limit(LIMIT);

  if (error || !data) return [];
  return data.map((p) => {
    const rel = p.district as { name?: string } | { name?: string }[] | null;
    return {
      id: p.id as string,
      code: p.property_code as string,
      title: (p.title as string | null) ?? null,
      price: p.list_price != null ? Number(p.list_price) : null,
      tx: p.transaction_type as string,
      district: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null,
    };
  });
}
