/**
 * İçe aktarma ÖNİZLEMESİNİN eşzamanlı planı (B049, SAF — vitest kapsamında).
 *
 * Eskiden parçalar sıralı gidiyordu ve dosya içi mükerrer durumu (`seen`) bir parçadan diğerine taşınıyordu: 5000 satır
 * = 20 sıralı sunucu turu (~6 sn). Şimdi:
 *   1) Parçalar 10'luk demetlerle gider; demetin içinde 4 eşzamanlı (sunucuda, `previewImportChunks`) ve `seen: []` ile
 *      önizlenir; her yanıt o parçanın KENDİ anahtarlarını döndürür.
 *   2) İstemci, her parça için "önceki parçalarda geçen ve bu parçada da olan" anahtarları hesaplar (`crossChunkSeen`).
 *   3) Yalnız böyle anahtarı olan parçalar (nadir) bu küçük kümeyle bir kez daha önizlenir — sonuç sıralı akışla BİREBİR aynı
 *      ("ilk satır kazanır"): bir parçanın anahtar kümesi `seen`'den bağımsızdır, dolayısıyla önceki parçaların birleşimi
 *      sıralı akıştaki `seen` ile aynıdır.
 * Anahtarlar sunucuda üretilir (telefon `parsePhoneStrict`, talep/görev anahtarı müşteri kimliği içerir): istemci kendi
 * anahtarını UYDURMAZ, yalnız sunucunun döndürdüğü kümeleri kesiştirir (işi küçük; ana iş parçacığında ~ms).
 */

/** Önizleme parçalarının SUNUCUDA eşzamanlılık sınırı (hız sınırı: pencere başına 120 parça). */
export const PREVIEW_CONCURRENCY = 4;

/**
 * Tek sunucu eylemi çağrısında gönderilen en çok parça (gövde ≈ 10 × 250 satır; eylem gövde sınırı 4 MB).
 * Next.js istemcisi sunucu eylemlerini sıraya koyduğundan eşzamanlılık demetin İÇİNDE (sunucuda) kurulur.
 */
export const PREVIEW_BATCH_MAX = 10;

/** Diziyi en çok `size` elemanlı demetlere böler (sıra korunur). */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}

/**
 * Her parça için, ÖNCEKİ parçalarda görülen anahtarlardan bu parçada da geçenler (sıralı akıştaki `seen` ile aynı etki,
 * ama yalnız gerekli küçük alt küme). Boş dizi: parça bağımsız sonucuyla doğrudur.
 */
export function crossChunkSeen(seenPerChunk: readonly (readonly string[])[]): string[][] {
  const earlier = new Set<string>();
  return seenPerChunk.map((keys) => {
    const own = new Set(keys);
    const carry = [...own].filter((k) => earlier.has(k));
    for (const k of own) earlier.add(k);
    return carry;
  });
}

/**
 * Sıra koruyan sınırlı eşzamanlı eşleme: en çok `limit` iş aynı anda; sonuç dizisi girdiyle aynı sıradadır.
 * Bir iş fırlatırsa kalanlar başlamaz ve hata yukarı taşınır. `onDone` her iş bitince (ilerleme çubuğu).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: () => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = e ?? new Error("mapLimit");
        return;
      }
      onDone?.();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed !== null) throw failed;
  return out;
}
