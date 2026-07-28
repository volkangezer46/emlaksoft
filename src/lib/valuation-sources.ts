/**
 * `valuations.sources` jsonb dizisi için ortak kural — SAF, sunucu bağımsız.
 *
 * `__` ile başlayan elemanlar DAHİLİ dökümdür (emsal anlık görüntüsü
 * `__emsal_dokumu`, vitrin talebi `__vitrin_talebi` ...): fiyat hesabına
 * girmezler (`weight: 0`) ve rapor sayfalarındaki "bilgi kaynakları"
 * listesinde GÖSTERİLMEZLER.
 *
 * Önceden her rapor sayfası tek tek `!== COMPARABLES_SOURCE_NAME` diye
 * süzüyordu; yeni bir dahili döküm eklendiğinde her sayfayı ayrı ayrı
 * güncellemek gerekiyor, biri atlanınca dahili kayıt müşteriye giden rapora
 * sızıyordu. Kural artık tek yerde.
 */
export function isInternalSource(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith("__");
}
