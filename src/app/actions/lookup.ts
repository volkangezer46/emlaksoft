"use server";

import { createClient } from "@/lib/supabase/server";
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
