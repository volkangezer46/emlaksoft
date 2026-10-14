/**
 * İlan kontrol sağlık skorundaki `eids` bileşeni (SAF). Tek kaynak: hem depolanan skor (engine.ts) hem canlı
 * yaşam döngüsü görünümü (lifecycle-model.ts) bunu kullanır; iki yer farklı sonuç vermez.
 *
 * present = null  → ölçülemedi (sütun okunamadı / migration uygulanmamış): paydadan çıkar, sahte skor yok.
 * present = false → EİDS taşınmaz numarası girilmemiş: 0.
 * present = true  → numara var: 1; ancak yetki süresi 3 aydan kısaysa 0.5 (EİDS yetki en az 3 ay olmalıdır).
 *
 * Yetki defteri durumu (20261013007100; verilirse): iptal / süresi dolmuş / reddedilmiş yetki numaradan bağımsız 0'dır;
 * EİDS istisnası (tapu yok / yabancı malik) bileşeni ölçüm dışı bırakır (null; paydadan çıkar, ceza da ödül de yok).
 */
export function eidsHealthValue(
  present: boolean | null | undefined,
  authorityShort = false,
  ledger?: { status?: string | null; exempt?: boolean | null },
): number | null {
  if (ledger?.exempt) return null;
  const s = ledger?.status;
  if (s === "revoked" || s === "expired" || s === "rejected") return 0;
  if (present === null || present === undefined) return null;
  if (!present) return 0;
  return authorityShort ? 0.5 : 1;
}
