import type { SupabaseClient } from "@supabase/supabase-js";
import { countSampleRecords, type SampleCountRow } from "@/lib/sample-clear";
import { SAMPLE_KPI_THRESHOLD, getSampleScope } from "@/lib/sample-scope";

/**
 * Demo modu durumu (sunucu, salt okunur; kullanıcı oturumu + RLS). Üst şerit bandı ve Ayarlar paneli
 * aynı kaynağı kullanır. Tablo/sütun yoksa ilgili satır `count: null` gelir ve gösterilmez.
 */

export type DemoBannerVariant = "demo" | "mixed" | "switch";

export type SampleStatus = {
  /** Silinecek örnek kayıt var mı (veya yükleme damgası duruyor mu). */
  active: boolean;
  total: number;
  rows: SampleCountRow[];
  realCustomers: number;
  realProperties: number;
  variant: DemoBannerVariant;
};

/** Gerçek veri girildikçe öneri değişir: boş → karışık → eşik aşıldı. */
export function pickBannerVariant(realCustomers: number, realProperties: number, threshold = SAMPLE_KPI_THRESHOLD): DemoBannerVariant {
  const real = Math.max(0, realCustomers) + Math.max(0, realProperties);
  if (real === 0) return "demo";
  if (realCustomers >= threshold || realProperties >= threshold) return "switch";
  return "mixed";
}

export async function loadSampleStatus(
  supabase: SupabaseClient,
  tenantId: string,
  seededAt: string | null,
): Promise<SampleStatus> {
  const [summary, scope] = await Promise.all([countSampleRecords(supabase, tenantId), getSampleScope(supabase, tenantId)]);
  const { realCustomers, realProperties } = scope.counts;
  return {
    active: summary.total > 0 || Boolean(seededAt),
    total: summary.total,
    rows: summary.rows,
    realCustomers,
    realProperties,
    variant: pickBannerVariant(realCustomers, realProperties),
  };
}
