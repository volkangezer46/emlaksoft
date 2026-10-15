import { revalidateTag, updateTag } from "next/cache";

/**
 * Admin sayaç önbellek etiketleri (TEK kaynak) ve geçersiz kılma (B011). Talep açma/çözme/öncelik/atama ve fatura /
 * abonelik eylemleri `bustAdminCounters()` çağırır: Kontrol paneli ve rozet bir SONRAKİ istekte (canlı olayla gelen
 * tazeleme dahil) taze okunur — bayat 60 sn panel yok. Sunucu eyleminde `updateTag` (kendi yazımını okur); rota
 * bağlamında `updateTag` fırlatır (Next 16), o zaman `revalidateTag(…, { expire: 0 })`. İkisi de olmazsa (test sahtesi,
 * istek dışı) sessiz geçer: sayaçlar yine en geç önbellek süresinde (10 / 30 sn) tazelenir.
 */
export const ADMIN_BADGES_TAG = "admin-badges";
export const ADMIN_DASHBOARD_TAG = "admin-dashboard";

export function bustAdminCounters(): void {
  for (const tag of [ADMIN_DASHBOARD_TAG, ADMIN_BADGES_TAG]) {
    try {
      updateTag(tag);
    } catch {
      try {
        revalidateTag(tag, { expire: 0 });
      } catch {
        /* istek bağlamı dışı: önbellek süresi dolunca tazelenir */
      }
    }
  }
}
