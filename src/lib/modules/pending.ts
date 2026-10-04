import type { SupabaseClient } from "@supabase/supabase-js";
import { groupPending, PENDING_DEFS, type PendingItem } from "@/lib/modules/pending-defs";
import type { FeatureKey } from "@/lib/modules/registry";

/**
 * Açık modüllerdeki bekleyen iş sayıları (RLS'li kullanıcı client'ı; tenant süzgeci RLS'ten gelir).
 * Okuma hatası sessizce 0 sayılmaz ama kapatmayı da engellemez: o satır uyarıdan düşer.
 */
export async function loadPendingByModule(
  supabase: SupabaseClient,
  openKeys: readonly FeatureKey[],
): Promise<Record<string, PendingItem[]>> {
  const open = new Set<string>(openKeys);
  const defs = PENDING_DEFS.filter((d) => open.has(d.module));
  const counts = new Map<string, number>();
  await Promise.all(
    defs.map(async (def) => {
      const { count, error } = await supabase
        .from(def.table)
        .select("id", { count: "exact", head: true })
        .in(def.column, [...def.values]);
      if (error) {
        console.error("modül bekleyen iş sayımı", def.id, error.message);
        return;
      }
      counts.set(def.id, count ?? 0);
    }),
  );
  return groupPending(counts);
}
