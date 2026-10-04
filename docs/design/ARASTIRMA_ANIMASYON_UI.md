# Araştırma: Animasyon, Mikro Etkileşim, Tema ve UI Bileşen Kaynakları

Tarih: 2026-10-04. Kapsam: yalnız belge; kod değişmedi, paket kurulmadı, hiçbir şey çalıştırılmadı.
Bağlam: Next 16.3.8 + React 19.2 + Tailwind 4 + Radix. /app ilk yük JS bütçesi ~213 KB brotli; BÜYÜTMEMEK ana kısıt.

## Yöntem ve güvenilirlik notu

- Sayfalar WebFetch ile açıldı (GitHub, resmi dokümanlar, Next dokümanı, bundlephobia API). Web metni veri olarak okundu.
- Boyutlar bundlephobia API'sinden (min+gzip, tüm bağımlılıklar dahil, tree-shaking YOK; gerçek paket genelde daha küçük). Özet küçük bir model tarafından çıkarıldığı için kaynak sayfa ile birebir doğrulanmadı; karar vermeden önce `npm run check:bundle` ile ölçülmeli.
- motion'ın npm kayıt (registry) sorgusu yanlış paketi döndürdü (eski "motion" paketi) -> sürüm/tarih DOĞRULANAMADI; motion için boyutlar motion.dev dokümanından, lisans ve sorun sayısı GitHub'dan alındı.
- Doğrulanamayanlar "doğrulanamadı" yazıldı. Son sürüm tarihi ve CVE bilgisi hiçbir aday için kaynaktan teyit edilemedi (GitHub özet sayfaları tarih vermedi); `npm audit` / `npm view <paket> time` ile kurmadan önce bakılmalı.
- Mevcut altyapı (repo okundu): `src/app/motion.css` (hover-lift, btn-press, list-stagger, progress-fill, tick-draw, ill-*, confetti; hepsi `prefers-reduced-motion: no-preference` içinde), `CountUp` (IntersectionObserver + rAF, ilk görünümde, SSR sonuç değeri basar), `Celebrate` + `celebrate.module.css` (saf CSS konfeti), `src/app/app/template.tsx` (React `<ViewTransition>` zaten kullanımda, Next 16.3 yapılandırmasız), `deal-board.tsx` (yerel HTML5 `draggable`/`onDragStart`, kütüphane yok), `command-search-panel.tsx` (komut paleti var), toast-provider var, Recharts var.

## Özet karar

- KUR: `@formkit/auto-animate` (liste ekle/çıkar), `@dnd-kit` (anlaşma panosu; yalnız pano rotasına bölünmüş parça), `@number-flow/react` (yalnız client'ta, lazy: canlı değişen sayılar). Ayrıca paket gerektirmeyen React `<ViewTransition>` genişletmesi.
- BELKİ: `motion` (yalnız LazyMotion + `m`, lazy parça içinde), `embla-carousel-react` (yalnız public vitrin), `tw-animate-css` (CSS-only ama elle 20 satırla da yapılır).
- KURMA: canvas-confetti, GSAP, react-spring, Lottie/dotLottie, Rive, Lordicon, Vaul, Sonner, cmdk, @tanstack/react-virtual, react-hook-form, Tiptap, Tremor, visx, react-day-picker, tailwindcss-motion, react-confetti-boom.
- En büyük ücretsiz kazanç paket değil, mevcut CSS kitini modern CSS ile genişletmek (son bölüm).

## Aday değerlendirmesi

### Animasyon

| Aday | Ne sağlar | Boyut (gzip) | Uyum ('use client'?) | Reduced-motion | Lisans | Bakım / güvenlik | EmlakSoft kullanımı / çakışma | Sınıf |
|---|---|---|---|---|---|---|---|---|
| motion (`motion/react`, eski framer-motion) | Bildirimsel animasyon, layout/exit, jest, sürükle | `motion` bileşeni 34 KB; `m`+`LazyMotion`+`domAnimation` ~4,6 KB ilk + ~15 KB özellik; `domMax` (+drag/layout) ~+25 KB; `useAnimate` mini 2,3 KB (WAAPI) | 'use client'; RSC'de `motion/react-client`; React 19 "first-class" (GitHub), sürüm tablosu doğrulanamadı | `MotionConfig reducedMotion="user"` | MIT | 33,8k yıldız, 101 açık sorun; CVE doğrulanamadı | Layout/exit gereken yerler (pano kart taşıma). CSS + ViewTransition çoğunu karşılıyor; mükerrer | BELKİ (yalnız lazy parça, `m`) |
| @formkit/auto-animate | Üst öğeye 1 satır: ekle/çıkar/yer değiştir animasyonu (WAAPI) | 3,2 KB, 0 bağımlılık | `useAutoAnimate` hook -> client ref; RSC içinde client sarmalayıcı gerekir; React 19 resmî sayfada açık değil ama ref-callback tabanlı | Otomatik: reduce'ta kapanır (resmî doküman) | MIT | 13,9k yıldız, 39 açık sorun; 0 bağımlılık (saldırı yüzeyi düşük) | Görev/hatırlatma listeleri, filtre çipleri, bildirim paneli, checklist. `list-stagger` yalnız ilk giriş; auto-animate ÇIKIŞ/yeniden sıralamayı kapatır; çakışma yok | KUR |
| react-spring | Fizik tabanlı animasyon | ~20 KB, 6 bağımlılık | Client | Elle | Doğrulanamadı (bilinen: MIT) | Doğrulanamadı | motion ile aynı iş, daha büyük | KURMA |
| GSAP | Zaman çizelgesi, scroll tetik, SVG | ~27 KB | Client | Elle (matchMedia) | Webflow sonrası ticari kullanım ücretsiz (resmî SSS), yasak: Webflow'a rakip görsel animasyon editörü. MIT değil, özel lisans; EmlakSoft kapsam dışı -> risk düşük | Doğrulanamadı | Kullanım yeri yok; /app'te gereksiz 27 KB | KURMA |
| lottie-react / dotLottie | After Effects animasyonu | `@lottiefiles/dotlottie-react` 33,9 KB + `dotlottie-web` (~329 KB ham, wasm); lottie-react doğrulanamadı | Client, canvas/wasm | Elle | Doğrulanamadı | Doğrulanamadı | `illustrations` zaten SVG+CSS; bütçeyi patlatır | KURMA |
| Rive | Etkileşimli vektör animasyon | `@rive-app/react-webgl2`; wasm boyutu/lisans doğrulanamadı | Client, canvas | Elle | Doğrulanamadı | Doğrulanamadı | Gereksiz, ağır | KURMA |
| @number-flow/react | Değer değişince hane hane kayan sayı, `Intl.NumberFormat` (para/yüzde, tr-TR) | 6,3 KB, 2 bağımlılık | 'use client'; bağımlılıksız/erişilebilir, `useCanAnimate`; React 19 teyidi doğrulanamadı | Varsayılan destekler | MIT | 7,7k yıldız, 10 açık sorun (sağlıklı) | CountUp yalnız İLK görünümde sayar, para/yüzde desteklemez; number-flow DEĞİŞİMDE çalışır: komisyon hesaplayıcı, değerleme sonucu, filtreyle değişen KPI. /app ilk yükte DEĞİL, lazy | KUR (lazy, dar kapsam) |
| CSS View Transitions (React `<ViewTransition>`) | Sayfa geçişi, paylaşılan öğe morph, Suspense reveal, yön (`transitionTypes`) | 0 KB (zaten kullanımda) | Next 16.3.8 dokümanı: yapılandırmasız; Chromium 125+ ve yeni Safari/Firefox; desteksizde animasyonsuz çalışır | Dokümanda `animation-duration:0s` örneği | Yerleşik | Yerleşik | `template.tsx` var; genişletilebilir | KUR (paket yok) |
| tw-animate-css | Tailwind 4 `animate-in/out`, `fade-in`, `slide-in-*` | CSS yalnız; kullanılan kadar çıkar | JS yok | Elle `motion-safe:` | MIT | 806 yıldız, 15 açık sorun, v2'de kırıcı değişiklik uyarısı | Radix `data-[state]` giriş/çıkış. `@starting-style` ile elle de yapılır | BELKİ |
| tailwindcss-motion | Tailwind motion yardımcıları | Doğrulanamadı | - | - | Doğrulanamadı | Doğrulanamadı | motion.css ile mükerrer | KURMA |
| canvas-confetti | Canvas konfeti | 4,3 KB, 0 bağımlılık | Client, imperatif | `disableForReducedMotion` seçeneği | ISC | 12,8k yıldız, 38 açık sorun | Mevcut CSS `Celebrate` (8 nokta, 1,2 sn) yeterli; kazanç düşük | KURMA |
| react-confetti-boom | Konfeti | Doğrulanamadı | - | - | Doğrulanamadı | - | Aynı gerekçe | KURMA |

### UI bileşen / kaynak kütüphaneleri

| Aday | Ne sağlar | Boyut (gzip) | Uyum | Lisans | EmlakSoft kullanımı / çakışma | Sınıf |
|---|---|---|---|---|---|---|
| shadcn/ui | Kopyala-yapıştır bileşen kodu (70+) | Kurulum yok | Radix + Tailwind 4 + React 19 | Doğrulanamadı (bilinen: MIT) | `src/components/ui` zaten Radix tabanlı; yalnız eksik bileşen için referans | BELKİ (referans) |
| Magic UI | Pazarlama odaklı animasyonlu bileşenler, çoğu motion ister | Bileşene bağlı | - | Sayfada doğrulanamadı | Yalnız public landing ilhamı; /app'e uygun değil | KURMA |
| Aceternity UI | Etkili bileşenler (Framer Motion), ücretsiz + ücretli ($169-$199) | Bileşene bağlı | - | Ticari kullanım serbest (fiyat sayfası), ayrıntı SSS'te doğrulanamadı | Ağır efektler; "premium ama sade" hedefe ters | KURMA |
| Origin UI | shadcn tabanlı koleksiyon | Doğrulanamadı | - | Doğrulanamadı | - | KURMA (doğrulanamadı) |
| Tremor | Dashboard grafikleri | Doğrulanamadı | - | - | Recharts + `premium/charts.tsx`, `sparkline.tsx` var | KURMA |
| visx | SVG grafik | Doğrulanamadı | - | - | Recharts ile çakışır | KURMA |
| Vaul | Drawer | 18,5 KB, 26 toplam bağımlılık | Client | Doğrulanamadı | Radix Dialog + CSS ile yapılır | KURMA |
| Sonner | Toast | 9,4 KB, 0 bağımlılık | Client | Doğrulanamadı | `toast-provider` var | KURMA |
| cmdk | Komut paleti | 14,9 KB, 25 toplam paket | Client | Doğrulanamadı | `command-search-panel.tsx` ve admin `command-palette.tsx` var | KURMA |
| embla-carousel-react | Carousel | 7,3 KB, 2 bağımlılık | Client | Doğrulanamadı | Public ilan galerisi (/app bütçesi dışı) | BELKİ |
| react-day-picker | Takvim | Doğrulanamadı | - | - | `date-range-field.tsx` var | KURMA |
| @tanstack/react-table | Tablo mantığı | Doğrulanamadı | - | - | `data-table.tsx` + `data-table-logic.ts` var | KURMA |
| @tanstack/react-virtual | Sanal liste | 7,8 KB, 1 bağımlılık | Client | Doğrulanamadı | Sunucu sayfalaması var | KURMA (şimdilik) |
| dnd-kit | Sürükle-bırak, klavye/dokunmatik, erişilebilirlik | `@dnd-kit/core` 14,2 KB (3 bağımlılık); yeni `@dnd-kit/react` ailesi ayrı, boyutu doğrulanamadı | Client; React 19 uyumu eski `core` için doğrulanamadı, yeni `@dnd-kit/react` önerilir | MIT | 17,7k yıldız, 88 açık sorun. `deal-board.tsx` yerel HTML5 drag: dokunmatikte çalışmaz, klavye yok. Pano rotası kendi parçası: /app ilk yüke etkisi 0 | KUR (pano rotasına özel) |
| react-hook-form | Form durumu | Doğrulanamadı | - | - | Sunucu eylemi + yerel form mimarisini böler | KURMA |
| Tiptap | Zengin metin | Doğrulanamadı (büyük) | - | - | İhtiyaç yok | KURMA |

### Tema / tasarım / tipografi

| Kaynak | Değerlendirme | Sınıf |
|---|---|---|
| Tailwind 4 `@theme` tokenları | Zaten `tokens.css`/`themes.css`; yeni araç gerekmez | (mevcut) |
| Radix Colors (12 adımlı palet mantığı) | Paket gerekmez; koyu tema için ölçek MANTIĞI ilham (1-2 zemin, 3-5 etkileşim, 9 vurgu, 11-12 metin). Fetch yapılmadı | İlham |
| Open Props | Token seti bizimkiyle çakışır; fetch yapılmadı | KURMA |
| Geist / Inter / Manrope, fontsource | Yazı tipi zaten var; ek font = ek bayt ve CLS riski (HIZ_OLCUM_RAPORU_3: mobil sekme çubuğu 0.024 kayma, geç font oturması) | KURMA |
| animate-ui, launch-ui | Fetch yapılmadı: doğrulanamadı | Doğrulanamadı |
| "Gece Altın" benzeri premium tema | Koyu zemin + tek sıcak vurgu (altın/amber) + yüksek kontrast metin + 1px ince kenarlık + gölge yerine katman parlaklığı; `theme-dark.css` içine token olarak, paket gerekmez | İlham |

### İllüstrasyon / ikon

| Kaynak | Değerlendirme | Sınıf |
|---|---|---|
| unDraw, Storyset | Fetch yapılmadı: doğrulanamadı; statik SVG renk/marka uyumsuzluğu; mevcut `illustrations/` marka renkli ve hareketli | KURMA |
| lucide-animated | MIT, kopyala-yapıştır model (GitHub); `motion` bağımlılığı doğrulanamadı. Bizde lucide-react var | BELKİ: CSS hover ile (aşağıda) çoğu iş görülür |
| Phosphor, Iconify | Ek set = ek bayt, lucide ile tutarsızlık; fetch yapılmadı | KURMA |
| Lordicon | Ücretsiz plan: ticari kullanım var AMA "atıf gerekli" (fiyat sayfası); lottie çalışma zamanı ağır | KURMA |

## Paket bütçesi etkisi

| Aday | /app ilk yük etkisi | Nerede yüklenir | Tahmini ek (gzip, üst sınır) | Not |
|---|---|---|---|---|
| ViewTransition / CSS | 0 | Zaten var | 0 | En iyi getiri/bayt |
| auto-animate | 0 (liste parçasına girer) veya +3,2 KB | Yalnız liste bileşeni olan parça | ~3,2 KB | Ortak `AnimatedList` istemci bileşeni |
| dnd-kit | 0 | Yalnız `/app/anlasmalar` pano parçası | ~14 KB (sortable gerekirse +; doğrulanamadı) | Yerel drag kodu silinir |
| number-flow | 0 | `next/dynamic`, yalnız ilgili ekran | ~6,3 KB | Hidrasyonda statik metin, değişimde animasyon |
| motion (LazyMotion) | 0 | Lazy parça | ~20 KB (4,6 + 15) | Yalnız gerçekten layout/exit gerekirse |
| embla | 0 (public) | Vitrin | ~7,3 KB | /app bütçesi dışı |
| tw-animate-css | 0 JS | CSS | Kullanılan kadar | Elle CSS ile 0 |
| Toplam | /app ilk yük 0 KB hedef | Tüm KUR'lar rota/lazy parçada | ~24 KB, hiçbiri ilk yükte değil | Kurulumdan sonra `npm run check:bundle` ile doğrula |

## Uygulama planı (en çok 6; sıra = öncelik)

Genel kural: kütüphane yalnız rota parçasında veya `next/dynamic` ile; ince bir sarmalayıcı arkasında (`src/components/ui/...`); zaman için `src/lib/clock.ts`; metinler Türkçe.

### 1. ViewTransition genişletme (paket yok) — `src/app/app/template.tsx`, `src/app/globals.css`
Liste -> detay geçişinde avatar/başlık paylaşılan öğe olarak morph olur (müşteri, portföy, anlaşma).

```tsx
import { ViewTransition } from "react";
<Link href={`/app/portfoyler/${p.id}`} transitionTypes={["nav-forward"]}>
  <ViewTransition name={`portfoy-${p.id}`} share="morph" default="none">
    <EntityThumb ... />
  </ViewTransition>
</Link>
// Detaydaki aynı thumb'a AYNI name/share/default
```
```css
::view-transition { pointer-events: none; }
::view-transition-group(.morph) { animation-duration: 320ms; }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*), ::view-transition-new(*), ::view-transition-group(*) { animation-duration: 0s !important; animation-delay: 0s !important; }
}
```
Not (Next dokümanı): morph, hedef içerik aynı commit'te render olursa çalışır (prefetch'li sayfalar); aksi halde giriş animasyonu oynar.

### 2. auto-animate — yeni `src/components/ui/animated-list.tsx`
```tsx
"use client";
import { useAutoAnimate } from "@formkit/auto-animate/react";
export function AnimatedList({ as: Tag = "ul", className, children }: {
  as?: "ul" | "div" | "ol"; className?: string; children: React.ReactNode;
}) {
  const [ref] = useAutoAnimate<HTMLElement>({ duration: 180 }); // reduce'ta kendiliğinden kapanır
  return <Tag ref={ref as never} className={className}>{children}</Tag>;
}
```
Yer: görev/hatırlatma listeleri, bildirim paneli, `list-kit/category-chips` seçili çipler, toplu seçim çubuğu. `list-stagger` ile aynı öğede kullanma (ilk giriş çakışır). React Compiler lint ile doğrula.

### 3. dnd-kit — `src/app/app/anlasmalar/deal-board.tsx`
Yerel `draggable/onDragStart/onDrop` yerine sensörlü sürükleme (Pointer + gecikmeli Touch + Keyboard). Sunucu eylemi (aşama değiştir) ve geri alma mantığı aynen kalır.
```tsx
"use client";
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  useSensor(KeyboardSensor),
);
function onDragEnd(e: DragEndEvent) {
  if (e.over) moveDealAction(String(e.active.id), String(e.over.id)); // mevcut eylem, requirePermission içinde
}
// <DndContext sensors={sensors} onDragEnd={onDragEnd}>; sütun = useDroppable, kart = useDraggable
```
Kurmadan önce: `@dnd-kit/core` mı yeni `@dnd-kit/react` mı React 19 için güncel -> doğrula. Erişilebilirlik duyuruları Türkçeleştirilmeli. Kazanç: dokunmatik pano ve klavye erişimi.

### 4. number-flow — `src/components/ui/animated-number.tsx` (lazy)
```tsx
"use client";
import NumberFlow from "@number-flow/react";
export default function AnimatedNumber({ value, currency }: { value: number; currency?: "TRY" | "USD" | "EUR" }) {
  return <NumberFlow value={value} locales="tr-TR"
    format={currency ? { style: "currency", currency, maximumFractionDigits: 0 } : undefined} />;
}
// çağıran: const AnimatedNumber = dynamic(() => import("@/components/ui/animated-number"));
```
Yer: komisyon hesaplayıcı, değerleme sonucu kartı, filtreyle değişen KPI şeridi. CountUp KALIR (ilk görünüm, 0 KB ek); ikisi aynı öğede kullanılmaz.

### 5. (BELKİ) motion LazyMotion — yalnız layout/exit gerçekten gerekirse
```tsx
"use client";
import { LazyMotion, m, MotionConfig, AnimatePresence } from "motion/react";
const features = () => import("motion/react").then((r) => r.domAnimation); // ayrı parça
<MotionConfig reducedMotion="user"><LazyMotion features={features} strict>
  <AnimatePresence initial={false}><m.div exit={{ opacity: 0, height: 0 }} /></AnimatePresence>
</LazyMotion></MotionConfig>
```
`strict` yanlışlıkla tam `motion` bileşeni (34 KB) import edilmesini yakalar. Önce auto-animate ve CSS yetmiyor mu bak.

### 6. (BELKİ) embla — yalnız public vitrin ilan galerisi
Mevcut galeri yoksa; `useEmblaCarousel({ loop: false })`, dokunmatik kaydırma + ok tuşları. /app'e GİRMEZ.

## Mevcut CSS motion kitinde ücretsiz iyileştirmeler (0 KB)

Tarayıcı desteği genel bilgidir, bu çalışmada doğrulanmadı; hepsi `@supports`/ilerici geliştirme ve `no-preference` koruması ile.

1. `@starting-style` + `transition-behavior: allow-discrete`: Radix dialog/popover/dropdown giriş VE çıkış animasyonu (`[data-state]`); tw-animate-css ihtiyacını siler.
2. `animation-timeline: view()` ile kaydırınca beliren kartlar (destekli tarayıcıda; desteksizde mevcut davranış).
3. Sayı animasyonu CSS ile: `@property --n { syntax: "<integer>"; inherits: false; initial-value: 0 }` + `counter-reset: n var(--n)`; para/binlik biçimi yok, bu yüzden CountUp kalır; yalnız adet/yüzde rozetlerinde uygun.
4. `linear()` ile yaylanma easing (`--ease-spring`): `btn-press`, switch ve tab göstergesinde.
5. `interpolate-size: allow-keywords` / `calc-size()` ile akordeon ve açılır panel yüksekliği (`inline-panel`, `inline-tabbed-panel`).
6. Skeleton "shimmer": `::after` translateX ile tek animasyon (transform/opacity bütçesinde); `skeleton.tsx` tutarlı.
7. İkon mikro etkileşimi (lucide-animated yerine): `.icon-hover:hover svg { transform: rotate(8deg) scale(1.05) }`, zil için mevcut `ill-swing`, onay için `tick-draw`; sidebar ve düğmelerde.
8. `status-badge` durum değişiminde renk `transition` + yeni durumda 1 kez `ill-pop`.
9. `::view-transition` kuralları: `pointer-events:none`, sidebar/header için `view-transition-name` ile sabitleme (Next dokümanı deseni), `transitionTypes` ile ileri/geri yön.
10. Konfeti: `Celebrate` 8 nokta; `.confetti > i` sayısı/renk çeşitliliği artırılabilir (örn. 16 parça, "büyük tutar" eşiğinde); canvas-confetti ihtiyacı doğmaz.
11. Tüm yeni hareketler `motion.css` içindeki `--motion-*` ve `--ease-out` tokenlarını kullanır; koyu temada gölge yerine kenarlık parlaklığı geçişi.

## Riskler ve kurulum öncesi kontrol listesi

- Her KUR adayı için: `npm view <paket> time.modified dist-tags` (son sürüm), `npm audit` (CVE), `npm run check:bundle`, React 19.2 + React Compiler lint ile deneme dalı.
- dnd-kit: iki paket ailesinden (core / @dnd-kit/react) hangisinin React 19 için güncel olduğu doğrulanamadı.
- number-flow ve auto-animate React 19 uyumu resmî sayfada açık yazmıyor -> deneme dalında doğrula.
- Ses/haptik önerilmedi (kapsam dışı).
