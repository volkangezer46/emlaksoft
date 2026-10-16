/**
 * TEK GÖRÜNÜM (sahip kararı 2026-10-16): "Sade / Dengeli / Tüm özellikleri göster" anahtarı ve çerezi kaldırıldı. Ortak
 * kit bileşenleri (KpiStrip, ListPage, SimpleFold, HelperText…) her kullanıcıda AYNI ayarlı yerleşimi kullanır; bu kanca
 * yalnız o yerleşimi seçen ortak noktadır (sabit `true`, sağlayıcı yok, istemci durumu yok).
 */
export function useSimpleMode(): boolean {
  return true;
}
