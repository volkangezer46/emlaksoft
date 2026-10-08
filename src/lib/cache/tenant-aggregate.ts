import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Ağır, sık değişmeyen OFİS agregaları (portal ROI, indirim analizi, ilan sağlığı sayıları, danışman kârlılığı...) için
 * kısa TTL'li sunucu önbelleği. `reporting/cache.ts` desenin aynısı; fark: yük (`run`) çağıranın RLS'li oturum istemcisiyle
 * kapanışta çalışır (admin client YOK) ve sonuç JSON'a çevrilebilir (Map/Date YOK) olmalıdır.
 *
 * TENANT İZOLASYONU: anahtar daima `tenantId` + `userId` + kapsam (`scope`: rol, şube, süzgeç...) taşır. Kullanıcı bazlı anahtar,
 * RLS ile kullanıcıya göre değişen satır görünürlüğünün (şube/rol kapsamı) başka kullanıcıya sızmasını imkânsız kılar; aynı
 * kullanıcının gezinmede tekrar açışı ise önbellekten gelir. Hata fırlatan çalıştırma önbelleğe YAZILMAZ.
 *
 * TAZELİK: TTL kısa (varsayılan 60 sn). Yazma action'ları `revalidateTenantData` (src/lib/revalidate.ts) üzerinden
 * `tenantAggregateTag(tenantId)` etiketini hemen düşürür (deal/gider/portföy/komisyon değişince).
 */
export const TENANT_AGGREGATE_TTL_SECONDS = 60;

export function tenantAggregateTag(tenantId: string) {
  return `tenant-agg:${tenantId}`;
}

/** Route handler gibi Server Action dışı bağlamlar için (stale-while-revalidate). */
export function invalidateTenantAggregates(tenantId: string) {
  revalidateTag(tenantAggregateTag(tenantId), "max");
}

export function cachedTenantAggregate<T>(
  name: string,
  key: { tenantId: string; userId: string; scope?: string },
  run: () => Promise<T>,
  ttlSeconds: number = TENANT_AGGREGATE_TTL_SECONDS,
): Promise<T> {
  const { tenantId, userId, scope } = key;
  return unstable_cache(run, ["tenant-agg", name, tenantId, userId, scope ?? "-"], {
    revalidate: ttlSeconds,
    tags: [tenantAggregateTag(tenantId)],
  })();
}
