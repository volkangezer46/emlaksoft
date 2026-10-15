/**
 * Hedef gerçekleşme yardımcıları (SAF + tek RPC sarmalayıcı; OA4). Takım/şube hedefi üyelerin TOPLAMIDIR:
 * kapsam bir profil listesine çözülür, anlaşma/gelir gerçekleşmesi üye başına sentetik hedeflerle (advisor-metrics tek
 * kaynak) hesaplanıp toplanır; randevu/portföy/çağrı tek RPC'de (`target_progress_counts`, 20261018080001) sayılır.
 */
import type { createClient } from "@/lib/supabase/server";

export { expandForActuals, foldActuals, targetMembers, type MemberRow, type ScopedTarget } from "@/lib/target-scope";

export type ProgressItem = {
  id: string;
  startIso: string;
  endIso: string;
  profileIds: string[] | null;
  appointments: boolean;
  listings: boolean;
  calls: boolean;
};
export type Progress = { appointments: number | null; listings: number | null; calls: number | null };

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseProgress(raw: unknown, items: readonly ProgressItem[]): Map<string, Progress> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, Record<string, unknown> | undefined>;
  const out = new Map<string, Progress>();
  for (const it of items) {
    const row = r[it.id];
    if (!row) return null;
    out.set(it.id, {
      appointments: it.appointments ? num(row.appointments) : null,
      listings: it.listings ? num(row.listings) : null,
      calls: it.calls ? num(row.calls) : null,
    });
  }
  return out;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Tek RPC; hata/eksik sonuçta null (çağıran faaliyet satırlarını çizmez — sahte sıfır yok). */
export async function loadTargetProgress(supabase: Supabase, tenantId: string, items: readonly ProgressItem[]): Promise<Map<string, Progress> | null> {
  if (items.length === 0) return new Map();
  const { data, error } = await supabase.rpc("target_progress_counts", {
    p_tenant_id: tenantId,
    p_items: items.map((i) => ({
      id: i.id,
      start_at: i.startIso,
      end_at: i.endIso,
      profile_ids: i.profileIds,
      want_appointments: i.appointments,
      want_listings: i.listings,
      want_calls: i.calls,
    })),
  });
  if (error) return null;
  return parseProgress(data, items);
}
