"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { orIlike, phoneDigitsNeedle, searchTermFilter } from "@/lib/pgrst";
import { getListScope } from "@/lib/access-control/list-scope";
import { applyScopeFilter } from "@/lib/access-control/query-scope";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DEAL_OPTION_SELECT, dealOptionLabel, type DealOptionSource } from "@/lib/deal-option-label";
import { lookupForeignCustomersByPhone, type ForeignCustomerHint } from "@/lib/duplicate-finders";

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
  const filter = searchTermFilter(q);
  if (!filter) return [];

  // Kapsam müşteri LİSTESİYLE AYNI (B059); arama tek çekirdekten (Türkçe katlama + telefon rakamları, B060).
  const [supabase, listScope] = await Promise.all([
    createClient(),
    getListScope({ userId: gate.userId, tenantId: gate.tenantId, role: gate.role }),
  ]);
  const { data, error } = await applyScopeFilter(
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .or(filter)
      .order("full_name")
      .limit(LIMIT),
    listScope.filter,
    { ownerColumn: "assigned_to" },
  );

  if (error || !data) return [];
  return data.map((c) => ({
    value: c.id,
    label: c.full_name ?? "İsimsiz",
    hint: c.phone ?? undefined,
  }));
}

export type CallerPhoneLookup = {
  /** Kapsam içindeki TEK eşleşme (birden çoksa ya da yoksa null: konsol seçmez). */
  match: (ComboboxOption & { phone: string | null }) | null;
  /** Kapsam içi eşleşme sayısı (0, 1 ya da "2+" için 2). */
  count: number;
  /** Kapsam DIŞI tam eşleşme: yalnız ad, maskeli telefon, danışman adı ("Bu numara X danışmanının müşterisi"). */
  foreign: ForeignCustomerHint[];
};

/**
 * Çağrı konsolu: numara tamamlanınca arayan müşteriyi bulur (B064). Kapsam içi tek eşleşme otomatik seçilir; kapsam dışı
 * tam eşleşmede yalnız maskeli bilgi döner (SECURITY DEFINER `lookup_customer_by_phone`). Salt-okunur.
 */
export async function lookupCustomerByPhone(phone: string): Promise<CallerPhoneLookup> {
  const empty: CallerPhoneLookup = { match: null, count: 0, foreign: [] };
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return empty;
  const needle = phoneDigitsNeedle(String(phone ?? "").slice(0, 40));
  if (!needle || needle.length < 10) return empty;

  const [supabase, listScope] = await Promise.all([
    createClient(),
    getListScope({ userId: gate.userId, tenantId: gate.tenantId, role: gate.role }),
  ]);
  const [own, foreign] = await Promise.all([
    applyScopeFilter(
      supabase
        .from("customers")
        .select("id, full_name, phone")
        .eq("tenant_id", gate.tenantId)
        .is("deleted_at", null)
        .ilike("phone_digits", `%${needle}%`)
        .limit(2),
      listScope.filter,
      { ownerColumn: "assigned_to" },
    ),
    lookupForeignCustomersByPhone(supabase, phone),
  ]);
  const rows = (own.data ?? []) as { id: string; full_name: string | null; phone: string | null }[];
  if (rows.length > 0) {
    const one = rows.length === 1 ? rows[0]! : null;
    return {
      match: one ? { value: one.id, label: one.full_name ?? "İsimsiz", hint: one.phone ?? undefined, phone: one.phone } : null,
      count: rows.length,
      foreign: [],
    };
  }
  return { match: null, count: 0, foreign };
}

/** Portföy arama sonucu: seçici seçeneği + liste fiyatı / işlem türü (form ön dolgusu için). */
export type PropertySearchOption = ComboboxOption & {
  list_price: number | null;
  transaction_type: string | null;
};

export async function searchProperties(query: string): Promise<PropertySearchOption[]> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, property_code, title, list_price, transaction_type")
    .is("deleted_at", null)
    .or(orIlike(["property_code", "title", "address_line"], q))
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error || !data) return [];
  return data.map((p) => ({
    value: p.id,
    label: p.title ?? "Başlıksız",
    hint: p.property_code,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    transaction_type: (p.transaction_type as string | null) ?? null,
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

/**
 * Anlaşma seçici araması (görev/gider bağları): müşteri adı ya da portföy kodu/başlığı.
 * PostgREST gömülü tabloda OR yapamadığı için önce eşleşen müşteri/portföy kimlikleri bulunur.
 */
export async function searchDeals(query: string): Promise<ComboboxOption[]> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return [];
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  const supabase = await createClient();
  const [{ data: cust }, { data: props }] = await Promise.all([
    // Müşteri adı araması tek çekirdekten (Türkçe katlamalı search_fold; "isik" → "Işık").
    supabase.from("customers").select("id").is("deleted_at", null).or(searchTermFilter(q) ?? "id.is.null").limit(LIMIT),
    supabase.from("properties").select("id").is("deleted_at", null).or(orIlike(["property_code", "title"], q)).limit(LIMIT),
  ]);
  const custIds = (cust ?? []).map((c) => c.id as string);
  const propIds = (props ?? []).map((p) => p.id as string);
  if (custIds.length === 0 && propIds.length === 0) return [];
  const clauses = [
    custIds.length ? `customer_id.in.(${custIds.join(",")})` : null,
    propIds.length ? `property_id.in.(${propIds.join(",")})` : null,
  ].filter(Boolean);
  const { data, error } = await supabase
    .from("deals")
    .select(`${DEAL_OPTION_SELECT}, stage`)
    .eq("tenant_id", gate.tenantId)
    .or(clauses.join(","))
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error || !data) return [];
  return (data as unknown as (DealOptionSource & { stage: string })[]).map((d) => ({
    value: d.id,
    label: dealOptionLabel(d),
    hint: d.stage === "won" ? "Kazanıldı" : d.stage === "lost" ? "Kaybedildi" : "Açık",
  }));
}
