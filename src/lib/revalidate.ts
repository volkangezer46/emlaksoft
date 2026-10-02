import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { invalidateReportsCache, reportsCacheTag } from "@/lib/reporting/cache";

/**
 * Yazma action'ları için tek giriş: path'leri tazeler ve tenant'ın rapor cache'ini düşürür.
 *
 * Rapor etiketi `updateTag` ile hemen süresi doldurulur (read-your-own-writes: yazan
 * kullanıcı /app/raporlar'a döndüğünde bayat sayı görmez). `updateTag` yalnız Server
 * Action bağlamında çalışır; başka bağlamda (route handler vb.) fırlatırsa
 * `revalidateTag(tag, "max")` (stale-while-revalidate) yoluna düşülür.
 *
 * tenantId yoksa rapor etiketi atlanır; yalnız path'ler tazelenir. Her zaman başarılı
 * yazmadan SONRA çağrılmalıdır.
 */
export function revalidateTenantData(tenantId: string | null | undefined, paths: readonly string[] = []) {
  for (const p of paths) revalidatePath(p);
  if (!tenantId) return;
  try {
    updateTag(reportsCacheTag(tenantId));
  } catch {
    invalidateReportsCache(tenantId);
  }
}
