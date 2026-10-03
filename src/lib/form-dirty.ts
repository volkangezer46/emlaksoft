/**
 * Sayfa içi sekme alanlarında "kaydedilmemiş değişiklik" koruması için saf yardımcılar (DOM'suz, birim testli).
 * Anlık görüntü: dosya olmayan FormData girdileri JSON dizisi olarak serileştirilir; iki görüntü eşit değilse form kirlidir.
 */

/** FormData benzeri girdi listesi -> karşılaştırılabilir metin (sıralı, dosyalar hariç). */
export function serializeEntries(entries: Iterable<[string, unknown]>): string {
  const rows: [string, string][] = [];
  for (const [k, v] of entries) {
    if (typeof v !== "string") continue;
    rows.push([k, v]);
  }
  rows.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return JSON.stringify(rows);
}

/** Başlangıç görüntüsü yoksa (henüz alınmadı) form kirli sayılmaz. */
export function isDirty(initial: string | null, current: string): boolean {
  return initial !== null && initial !== current;
}
