import type { createClient } from "@/lib/supabase/server";
import { inFilter, orIlike, safeLike } from "@/lib/pgrst";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Liste aramasında ilişkili kayıt adıyla eşleşme: müşteri adı / portföy başlığı-kodu önce kendi
 * tablosunda aranır, bulunan id'ler ana sorgunun `.or()` koşuluna girer (join'li kolonda ilike
 * desteklenmediği için). Arama metni `pgrst.ts` ile temizlenir (PostgREST gramerini bozamaz).
 *
 * - `clause`: ana sorguya `.or(clause)` olarak eklenecek ifade (ya da null).
 * - `empty`: arama var ama hiçbir şey eşleşmedi → ana sorgu çalıştırılmadan "sonuç yok" döner.
 */
export async function relatedSearchClause(
  supabase: Supabase,
  q: string,
  spec: { customerColumn?: string; propertyColumn?: string; extraColumns?: string[] },
): Promise<{ clause: string | null; empty: boolean }> {
  const term = q.trim();
  if (!term) return { clause: null, empty: false };
  const [customers, properties] = await Promise.all([
    spec.customerColumn
      ? supabase.from("customers").select("id").ilike("full_name", safeLike(term)).is("deleted_at", null).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: null }),
    spec.propertyColumn
      ? supabase
          .from("properties")
          .select("id")
          .or(orIlike(["title", "property_code"], term))
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: null }),
  ]);
  const parts: string[] = [];
  if (spec.customerColumn) {
    const c = inFilter(spec.customerColumn, (customers.data ?? []).map((r: { id: string }) => r.id));
    if (c) parts.push(c);
  }
  if (spec.propertyColumn) {
    const p = inFilter(spec.propertyColumn, (properties.data ?? []).map((r: { id: string }) => r.id));
    if (p) parts.push(p);
  }
  if (spec.extraColumns?.length) parts.push(orIlike(spec.extraColumns, term));
  return parts.length > 0 ? { clause: parts.join(","), empty: false } : { clause: null, empty: true };
}
