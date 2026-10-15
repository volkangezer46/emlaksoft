import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type { createClient } from "@/lib/supabase/server";

/**
 * Raporlar sayfasının iki veri kaynağı (20261016060000):
 *
 * 1) OFİS GENELİ — `tenant_reporting_aggregates`: sayımlar, kaynak/kayıp/ROI, kaçan komisyon tahmini.
 *    Sonuç kullanıcıdan BAĞIMSIZDIR (RPC'de auth.uid()/earnings_all/expenses kapısına bağlı alan yok), bu yüzden kısa TTL
 *    kiracı anahtarlı önbellekte tutulur: anahtar `["reports-aggregates", "office", tenantId]`, etiket `reports:<tenantId>`.
 * 2) İZLEYENE GÖRE — `tenant_reporting_viewer_aggregates`: bu ayın komisyonu + 12 ay gelir/gider serisi. earnings_all yoksa
 *    yalnız kullanıcının KENDİ komisyonları, expenses:view yoksa gider serisi null. Bu kısım ÖNBELLEKSİZDİR (hafif RPC; her
 *    istekte çağıranın oturumuyla). SK6/B158: eskiden tek RPC kiracı anahtarıyla önbelleğe giriyordu; önbelleği hangi kullanıcı
 *    doldurursa ofisteki herkes 60 sn onun sonucunu görüyordu (danışman ofis cirosunu, sahip 0 ₺).
 *
 * Güvenlik: RPC'ler kendi içinde `current_active_tenant_id()` + `reports:view` kontrolü yapar; çağıran sayfa
 * `requireModulePage("reports")` kapısından geçmiştir. `unstable_cache` içinde cookie okunamadığı için RLS'li oturum client'ı
 * dışarıda oluşturulup kapanışla taşınır (admin client YOK). tenantId bilinmiyorsa (platform staff) önbellek atlanır.
 *
 * Tazelik: TTL kısa (REPORT_TTL_SECONDS); yazma action'ları `invalidateReportsCache` ile etiketi düşürür.
 */
export const REPORT_TTL_SECONDS = 60;

export function reportsCacheTag(tenantId: string) {
  return `reports:${tenantId}`;
}

/** Ofis geneli rapor önbelleğinin anahtarı (kullanıcı kimliği İÇERMEZ: sonuç kullanıcıdan bağımsızdır). */
export function reportsOfficeCacheKey(tenantId: string) {
  return ["reports-aggregates", "office", tenantId];
}

/** Yazma action'larından çağrılır: rapor cache'ini bu tenant için düşürür. */
export function invalidateReportsCache(tenantId: string) {
  revalidateTag(reportsCacheTag(tenantId), "max");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Ofis geneli (kullanıcıdan bağımsız) rapor toplulaştırması — kiracı anahtarlı kısa TTL önbellek. */
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
    reportsOfficeCacheKey(tenantId),
    { revalidate: REPORT_TTL_SECONDS, tags: [reportsCacheTag(tenantId)] },
  )().catch((e: unknown) => {
    if (e instanceof ReportsFetchError) return e.res;
    throw e;
  });
}

/**
 * İzleyene göre değişen kısım (komisyon toplamları + gider serisi) — ÖNBELLEKSİZ, çağıranın oturumuyla.
 * Kiracılar ya da aynı kiracıdaki kullanıcılar arasında hiçbir sonuç paylaşılmaz.
 */
export function getViewerReportingAggregates(supabase: Supabase, asOfMs: number) {
  return supabase.rpc("tenant_reporting_viewer_aggregates", { p_as_of: new Date(asOfMs).toISOString() });
}

class ReportsFetchError extends Error {
  constructor(public res: { data: unknown; error: { code?: string | null; message?: string | null } | null }) {
    super("reports fetch failed");
  }
}
