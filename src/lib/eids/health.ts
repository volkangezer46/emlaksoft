/**
 * İlan kontrol sağlık skorundaki `eids` bileşeni (SAF). Tek kaynak: hem depolanan skor (engine.ts) hem canlı
 * yaşam döngüsü görünümü (lifecycle-model.ts) bunu kullanır; iki yer farklı sonuç vermez.
 *
 * present = null  → ölçülemedi (sütun okunamadı / migration uygulanmamış): paydadan çıkar, sahte skor yok.
 * present = false → EİDS taşınmaz numarası girilmemiş: 0.
 * present = true  → numara var: 1; ancak yetki süresi 3 aydan kısaysa 0.5 (EİDS yetki en az 3 ay olmalıdır).
 */
export function eidsHealthValue(present: boolean | null | undefined, authorityShort = false): number | null {
  if (present === null || present === undefined) return null;
  if (!present) return 0;
  return authorityShort ? 0.5 : 1;
}
