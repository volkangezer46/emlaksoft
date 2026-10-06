import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { INSIGHT_EXCLUDED_ROLES, INSIGHT_STATES, type Insight, type InsightState } from "@/lib/insights/types";
import { INSIGHT_SELECT, selectReadable, type InsightDbRow } from "@/lib/insights/readable";

/**
 * TİPLİ OKUYUCU (ana ekran ve diğer yüzeyler bunu kullanır).
 *
 * - RLS'li oturum istemcisi (admin client YOK). Satır ayrıca `recipient_user_id = userId` ile daraltılır:
 *   RLS owner/gm'e ofisin tüm satırlarını açar, ama "benim içgörülerim" yalnız kendiminkidir.
 * - Hata, tablo yok (migration uygulanmadı), rol içgörü almıyor → BOŞ DİZİ. ASLA fırlatmaz (ana ekran bozulmasın).
 * - Süresi geçen, kapanan (yoksayılan/uygulanan) ve erteleme süresi dolmamış satırlar okunmaz.
 * - Tek indeksli sorgu: (tenant_id, recipient_user_id, priority desc) kısmi indeksi.
 */

export type GetInsightsArgs = {
  tenantId: string;
  userId: string;
  role: string;
  /** Varsayılan 8, en çok 50. */
  limit?: number;
  /** Test/özel kullanım için enjekte edilebilir; verilmezse oturum istemcisi. */
  client?: SupabaseClient;
};

const clampLimit = (n: number | undefined, def: number): number => Math.min(50, Math.max(1, Math.trunc(n ?? def) || def));

/** Rol içgörü alabilir mi? */
export function roleReceivesInsights(role: string): boolean {
  return !(INSIGHT_EXCLUDED_ROLES as readonly string[]).includes(role);
}

export async function getInsightsForUser(args: GetInsightsArgs): Promise<Insight[]> {
  try {
    if (!args.tenantId || !args.userId || !roleReceivesInsights(args.role)) return [];
    const limit = clampLimit(args.limit, 8);
    const supabase = args.client ?? (await createClient());
    const nowMs = now();
    const { data, error } = await supabase
      .from("insights")
      .select(INSIGHT_SELECT)
      .eq("tenant_id", args.tenantId)
      .eq("recipient_user_id", args.userId)
      .in("state", ["new", "seen", "snoozed"])
      .gt("valid_until", new Date(nowMs).toISOString())
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      // Ertelenmiş (henüz uyanmamış) satırlar JS'te elenir; payı için sorgu limiti geniş tutulur.
      .limit(Math.min(200, limit * 4));
    if (error || !data) return [];
    return selectReadable(data as InsightDbRow[], nowMs, limit);
  } catch {
    return [];
  }
}

export type InsightStateCounts = Record<InsightState, number>;

const emptyCounts = (): InsightStateCounts => Object.fromEntries(INSIGHT_STATES.map((s) => [s, 0])) as InsightStateCounts;

/**
 * Kullanıcının süresi geçmemiş içgörülerinin durum sayıları. "Tüm içgörüler (N)" bağlantısı için
 * `new + seen` (+ uyanmış `snoozed`) toplamı kullanılır. Hata = sıfırlar.
 */
export async function countInsightsByState(args: { tenantId: string; userId: string; role: string; client?: SupabaseClient }): Promise<InsightStateCounts> {
  const out = emptyCounts();
  try {
    if (!args.tenantId || !args.userId || !roleReceivesInsights(args.role)) return out;
    const supabase = args.client ?? (await createClient());
    const nowMs = now();
    const { data, error } = await supabase
      .from("insights")
      .select("state, snoozed_until, valid_until")
      .eq("tenant_id", args.tenantId)
      .eq("recipient_user_id", args.userId)
      .gt("valid_until", new Date(nowMs).toISOString())
      .limit(1000);
    if (error || !data) return out;
    for (const r of data as { state: string; snoozed_until: string | null; valid_until: string }[]) {
      if (!(INSIGHT_STATES as readonly string[]).includes(r.state)) continue;
      // Uyanmamış erteleme "snoozed" olarak sayılır; uyanmış olan okunabilirdir ve "new/seen" gibi davranır (sayıda snoozed kalır).
      out[r.state as InsightState] += 1;
    }
    return out;
  } catch {
    return emptyCounts();
  }
}

