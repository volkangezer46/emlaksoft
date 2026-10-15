/**
 * Panel sayfa geçişi — yalnız CSS (motion.css `.motion-page`, yalnız opacity).
 *
 * İlk açılışta animasyon YOKTUR (B027): içerik DOM'a girdiği karede tam opaktır (eskiden 150 ms boyunca %35 opaklıktan
 * başlıyordu). Yalnız yumuşak gezinmede (`html[data-soft-nav]`) 100 ms, %70 opaklıktan hafif giriş.
 * React <ViewTransition> / View Transitions API KALDIRILDI (2026-10 hız ölçümü): her gezinmede tarayıcı sayfayı
 * anlık görüntüye alıp `documentElement.clientHeight` + `getBoundingClientRect` ile zorunlu düzen hesaplatıyordu
 * (canlı profilde gezinme başına ~530 ms ana iş parçacığı, tıklama geri bildirimi ve içerik gecikiyordu).
 * Şablon her gezinmede yeniden bağlandığı için CSS animasyonu her gezinmede çalışır; hareket azaltmada kapalıdır.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="motion-page">{children}</div>;
}
