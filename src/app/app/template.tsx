/**
 * Panel sayfa geçişi — yalnız CSS (motion.css `.motion-page`, --motion-nav 150 ms, yalnız opacity).
 *
 * React <ViewTransition> / View Transitions API KALDIRILDI (2026-10 hız ölçümü): her gezinmede tarayıcı sayfayı
 * anlık görüntüye alıp `documentElement.clientHeight` + `getBoundingClientRect` ile zorunlu düzen hesaplatıyordu
 * (canlı profilde gezinme başına ~530 ms ana iş parçacığı, tıklama geri bildirimi ve içerik gecikiyordu).
 * Şablon her gezinmede yeniden bağlandığı için CSS animasyonu her sayfada çalışır; hareket azaltmada kapalıdır.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="motion-page">{children}</div>;
}
