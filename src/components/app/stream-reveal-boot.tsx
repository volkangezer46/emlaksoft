/**
 * React 19.2 akışlı gösterim kısıtı (B021): sunucu akışında geç gelen Suspense içeriği, kabuğun ilk boyamasından en az
 * 300 ms sonra açılır. React'in `$RC` çalışma zamanı `$RT` (kabuğun boyandığı an, `performance.now()`) SAYI ise
 * `setTimeout(…, $RT + 300 - now)` ile bekletir; sayı DEĞİLSE içeriği geldiği karede (`requestAnimationFrame`) açar.
 * Canlı ölçüm: HTML bitişi → içerik medyan 293 ms (veri 30-60 ms'de gelse de içerik gri iskelette bekliyordu).
 *
 * Bu betik panelde `$RT`'yi hiç sayıya dönmeyen bir erişimciyle tanımlar: içerik geldiği karede açılır; aynı karede
 * gelen sınırlar yine TEK seferde açılır (React'in `$RB` toplu kuyruğu aynen çalışır). Yalnız SSR akışını etkiler
 * (istemci gezinmesinde React'in kendi kısıtı sürer; orada tam önceden yükleme var). React değişkeni değiştirirse
 * betik etkisiz kalır ve davranış eski kısıta döner (`stream-reveal-contract.test.ts` React çalışma zamanını denetler).
 * CSP rapor modu bu metnin özetini taşır (src/lib/security/csp-report-only.ts INLINE_SCRIPT_HASHES.streamReveal).
 */
export const STREAM_REVEAL_SCRIPT =
  'try{Object.defineProperty(window,"$RT",{configurable:true,get:function(){},set:function(){}})}catch(e){}';

/** Kabuğun EN BAŞINDA (ilk Suspense sınırından önce) çizilir: `$RC` ilk çağrıldığında erişimci kurulmuş olur. */
export function StreamRevealBoot() {
  return <script dangerouslySetInnerHTML={{ __html: STREAM_REVEAL_SCRIPT }} />;
}
