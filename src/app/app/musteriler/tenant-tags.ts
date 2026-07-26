import type { createClient } from "@/lib/supabase/server";

/**
 * Tenant'taki müşterilerde kullanılan benzersiz etiketler — tek toplu sorgu.
 * Liste filtresi select'i, 360 chip input önerileri ve toplu etiketleme
 * dialog'u aynı listeyi kullanır. RLS tenant izolasyonunu sağlar; yalnız
 * silinmemiş ve etiketi olan kayıtlar taranır.
 */
export async function fetchTenantTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("tags")
    .is("deleted_at", null)
    .neq("tags", "{}")
    .limit(2000);
  if (error) {
    console.error("fetchTenantTags", error);
    return [];
  }
  const set = new Set<string>();
  for (const row of (data ?? []) as { tags: string[] | null }[]) {
    for (const tag of row.tags ?? []) {
      const t = tag.trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "tr"));
}
