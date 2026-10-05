/** Etiket yönetimi saf mantığı (sunucu action'ı + birim test ortak kullanır). */

export const TAG_MAX_LEN = 30;
/** Aynı anda çalışan müşteri güncellemesi sayısı (parçalı toplu güncelleme). */
export const TAG_UPDATE_CHUNK = 25;

export function normalizeTag(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

export function tagKey(tag: string): string {
  return tag.toLocaleLowerCase("tr-TR");
}

/**
 * Bir müşterinin etiket listesinde `src` etiketini `dst` ile değiştirir (null = kaldır).
 * Hedef zaten varsa birleşir (tekrar yazılmaz). `src` yoksa null döner (güncelleme gerekmez).
 */
export function rewriteTagList(tags: string[], src: string, dst: string | null): string[] | null {
  const srcKey = tagKey(normalizeTag(src));
  if (!tags.some((t) => tagKey(normalizeTag(t)) === srcKey)) return null;
  const next: string[] = [];
  for (const t of tags) {
    const n = tagKey(normalizeTag(t)) === srcKey ? dst : t;
    if (n && !next.some((x) => tagKey(x) === tagKey(n))) next.push(n);
  }
  return next;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Kullanıcıya gösterilen sonuç mesajı: kaç müşteri güncellendi, kaçında hata oldu. */
export function describeTagRewrite(affected: number, failed: number, total: number): string {
  if (failed === 0) return `${affected} müşteride güncellendi.`;
  return `${total} müşteriden ${affected}'inde güncellendi, ${failed}'inde hata oldu. Tekrar çalıştırırsanız yalnız kalanlar işlenir.`;
}
