import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type { createClient } from "@/lib/supabase/server";

/**
 * Rapor toplulaştırması (tenant_reporting_aggregates) için kısa TTL tenant-tag cache.
 *
 * Güvenlik: RPC kendi içinde `current_active_tenant_id()` + `reports:view` kontrolü
 * yapar; çağıran sayfa `requireModulePage("reports")` kapısından geçmiştir. Cache
 * anahtarı tenantId içerir; RPC, çağıranın (RLS'li) oturum client'ıyla çalışır —
 * `unstable_cache` içinde cookie okunamadığı için client dışarıda oluşturulup
 * kapanışla taşınır (admin client YOK). tenantId bilinmiyorsa (platform staff)
 * cache atlanır.
 *
 * Tazelik: TTL kısa (REPORT_TTL_SECONDS); `as_of` cache dolduran istekte hesaplanır
 * (anahtarda yok, TTL içinde aynı snapshot döner). Yazma action'ları `reports:<tenantId>` etiketini
 * `invalidateReportsCache` ile düşürebilir.
 */
export const REPORT_TTL_SECONDS = 60;

export function reportsCacheTag(tenantId: string) {
  return `reports:${tenantId}`;
}

/** Yazma action'larından çağrılır: rapor cache'ini bu tenant için düşürür. */
export function invalidateReportsCache(tenantId: string) {
  revalidateTag(reportsCacheTag(tenantId), "max");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function getTenantReportingAggregates(
  supabase: Supabase,
  tenantId: string | null,
  asOfMs: number,
) {
  const asOfIso = new Date(asOfMs).toISOString();
  const run = () => supabase.rpc("tenant_reporting_aggregates", { p_as_of: asOfIso });
  if (!tenantId) return run();
  return unstable_cache(
    async () => {
      const res = await run();
      // Hata/boş sonuç cache'lenmez: throw → cache'e yazılmaz, çağıran yeniden dener.
      if (res.error || res.data == null) throw new ReportsFetchError(res);
      return { data: res.data, error: null };
    },
    ["reports-aggregates", tenantId],
    { revalidate: REPORT_TTL_SECONDS, tags: [reportsCacheTag(tenantId)] },
  )().catch((e: unknown) => {
    if (e instanceof ReportsFetchError) return e.res;
    throw e;
  });
}

class ReportsFetchError extends Error {
  constructor(public res: { data: unknown; error: { code?: string | null; message?: string | null } | null }) {
    super("reports fetch failed");
  }
}
