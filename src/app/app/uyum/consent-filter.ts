/**
 * Uyum merkezi izin listesi süzgeci (SAF). "Bekleyen" (durum=pending) KPI'ı bekliyor + bilinmiyor toplamıdır;
 * süzgeç aynı kümeyi vermeli (sıfır çıkmaz metrik: sayı ile hedef liste eşleşir). Diğer durumlar birebir eşleşir.
 */
export function matchesConsentFilter(row: { channel: string; status: string }, f: { kanal?: string; durum?: string }): boolean {
  if (f.kanal && row.channel !== f.kanal) return false;
  if (!f.durum) return true;
  return row.status === f.durum || (f.durum === "pending" && row.status === "unknown");
}
