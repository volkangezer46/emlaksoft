# EmlakSoft Ana Sayfa Tasarım Şartnamesi (v1)

Kapsam: `src/app/page.tsx`, `src/components/marketing/*`, `site-header.tsx`, `site-footer.tsx`. Bu belge kod değildir; uygulama ajanı için şartnamedir.

Teşhis: Mevcut sayfa düzgün ama "kutu-kutu-kutu" ritmindedir. Tüm bölümler aynı ağırlıkta ve aynı kart dilinde. Tek bir "imza" an yok, ürün ekranı gerçek bir cihazda/derinlikte görünmüyor, tipografi tek tonlu (hep `font-extrabold`). Zenginlik içerik çoğaltarak değil; derinlik, ritim, ölçek kontrastı ve ürün gerçekçiliğiyle gelir.

## (a) Referans analizi

Not: Araçla yalnız metne indirgenmiş özetler alınabildi (bazı siteler 403 veya bağlantı hatası verdi); desenler bu özetler ve tasarım yazılarından çıkarıldı. Hiçbir varlık veya metin kopyalanmaz.

1. **Linear:** Ortalı büyük başlık, hemen altında geniş ürün ekranı; nötr palet + tek vurgu; sekmeli iş akışı gösterimi; etkinlik akışıyla "canlı ürün" hissi. Alınacak: ürün ekranı hero'nun kendisidir; renk kısıtlıdır.
2. **Stripe:** İki sütun hero, sağda yoğun gradyan/dalga derinliği; bento kartlarda gerçek dashboard parçaları; büyük metrik çağrıları. Alınacak: katmanlı gradyan zemin + kart içinde "gerçek arayüz kırpıntısı".
3. **Vercel:** Paralel yapılı özellik kartları, ince ızgara çizgileri, katı hiyerarşi (birincil/ikincil/üçüncül). Alınacak: ince ızgara dokusu, tutarlı kart anatomisi (başlık, kanıt, maddeler).
4. **Attio:** CRM'e özgü anlatı: bağlam katmanı, aşamalı satış akışı, otomasyonun zamana bağlanması ("gece çalışır"). Alınacak: otomasyonu somut anlat (bizde: 27 otomatik görev).
5. **Mercury:** Sakin, güven veren, bol boşluk, ürün cihaz içinde, güvenlik ayrı ve net. Alınacak: sakin premium ton; güvenlik/uyum bölümünün somutluğu.
6. **Ramp:** Kısa, aşamalı kurulum ritmi; "birden çok aracın yerine tek çatı" çerçevesi. Alınacak: nasıl-çalışır adımlarının netliği (süre/rakam uydurmayız).
7. **Raycast:** Klavye-öncelikli estetik, kısayol tuşu rozetleri, koyu yüzeyde ince parıltı. Alınacak: `kbd` rozetleri ve komut paleti illüstrasyonu (akıllı arama bölümüne uygun).
8. **Follow Up Boss, kvCORE, Compass araçları, Zillow Premier Agent (emlak CRM'leri):** Sektör normu: talep akışı, mobil uygulama, sosyal kanıt şeritleri, entegrasyon logoları. Boşluk: Türkiye'ye özgü olanlar (SMS imza, KVKK, İYS/EİDS, komisyon kaybı) hiçbirinde yok. Alınacak: sektör dilini bil, farkı Türkiye gerçeğinde kur. Sosyal kanıtı uyduramayız; yerine "doğrulanabilir gerçekler şeridi".
9. **Framer, Notion, Arc (genel desenler):** Kinetik başlık, scroll ile aşamalı açılan bölümler, serif/sans editoryal vurgu, disiplinli mikro hareket. Alınacak: tek kelimelik serif italik vurgu; scroll'da belirme.
10. **Yazılar (2026 SaaS landing, bento rehberi):** Hero'da gerçek ürün ekranı, değişken boy bento kartları (büyük kart amiral özellik), tek vurgu rengi, mobil mikro animasyon.

Ortak sonuç: (1) hero = ürün, (2) tek vurgu rengi + sakin zemin, (3) bento ile ritim kırma, (4) bir-iki "imza bölüm", (5) somut doğrulanabilir sayılar, (6) ayrı güven bölümü.

## (b) Seçilen yön: "Aydınlık Mimari"

Kimlik: ofis/mimari plan hassasiyeti. İnce çizgi ızgarası (kroki kâğıdı), sıcak beyaz zemin, derin lacivert mürekkep, tek vurgu mavi; mint (kazanç) ve amber/kırmızı (kayıp) yalnız anlam taşır. Gerekçe: emlak güven işidir; neon "AI" estetiği ofis sahibi kitleyle uyuşmaz; public sayfalar zaten açık tema kuralındadır.

**Tipografi**
- Başlık: Manrope (mevcut), ağırlık 700 (800 değil), `tracking -0.035em`, satır 1.04. Kontrast ağırlıkla değil ölçekle kurulur.
- Gövde: Inter (mevcut), 17-18px / 1.65.
- Vurgu (YENİ, gerekçeli): `Instrument Serif` (Google Fonts, ücretsiz, latin-ext destekli); yalnız başlıklarda 1-2 kelimelik italik vurgu. Editoryal sıcaklık katar. Tek ağırlık (400, italic), `display:"swap"`. Uygulayıcı İ/ı/ş/ğ glifini doğrulamalı; sorun varsa vurgu Manrope italik 600'e düşer.
- Mono: Geist Mono (mevcut), yalnız kısayol/rakam rozetleri.
- Ölçek: h1 `clamp(2.5rem, 1.2rem + 5.2vw, 5rem)`; h2 `clamp(2rem, 1.2rem + 2.6vw, 3.25rem)`; h3 1.375rem; lead 1.1875rem; eyebrow 0.75rem büyük harf, `tracking .14em`, 600.

**Renk (hex)**
- Zemin `#fbfaf7`, alt zemin `#f4f2ec`, kart `#ffffff`, çizgi `#e7e3da`, ızgara `rgba(10,34,71,.06)`.
- Mürekkep `#071a38`, gövde `#334155`, soluk `#5b6577` (AA).
- Vurgu mavi `#1463ff` (düğme zemini ve büyük metin); küçük metin bağlantısı `#0b4fd6`.
- Mint `#0e9f8c` (metin için `#08705f`), amber `#e0a53a`, kayıp kırmızısı `#cf3438`.
- Koyu bant (güvenlik, son CTA, kayıp-kaçak): `#071a38 -> #0a2247` gradyan; mevcut `theme-dark` yerel sınıfıyla, sayfa teması açık kalır.

**Derinlik:** 3 katman: zemin (ızgara + radyal ışık), orta (kart/cihaz, `--elev-3`), ön (süzülen rozet/kart, `--elev-5` + `--inner-top`). Cam (backdrop-blur) yalnız başlıkta ve süzülen rozetlerde; kart gövdesi opak. Gölgeler lacivert tonlu, asla saf siyah.

**Izgara:** 12 sütun, içerik max 1200px (hero 1360px), yan boşluk 16/24/32. Bölüm dikey boşluğu `clamp(4rem, 3rem + 6vw, 8rem)`.
**Köşe yarıçapı:** kart 20px, cihaz 28px, düğme 12px, rozet 999px, iç öğe 10px.
**Hareket:** üç tür: (1) scroll ile belirme (`opacity + translateY 16px`, 600ms, `cubic-bezier(.2,.7,.2,1)`); (2) hero kartlarında 6-9 sn süzülme (±8px); (3) hover'da 2px yükselme. Hepsi reduced-motion'da kapalı. Scroll belirme `animation-timeline: view()` ile ve yalnız `@supports` içinde (desteklemeyen tarayıcıda içerik zaten görünür; LCP/CLS etkilenmez).

## (c) Sayfa mimarisi

Metinler doğrulanabilir iddialarla sınırlıdır: 14 gün deneme (kartsız), 27 otomatik görev (`vercel.json`), 9 iş başlığı (`nav-config.ts`), 4 paket (Danışman 990, Ofis 2.490, Profesyonel 5.990, Kurumsal 12.900 TL/ay; yıllık %20 indirim), kayıp-kaçak yalnız Profesyonel, SMS onaylı dijital imza Ofis ve üstü. Fiyat ve paket özellikleri her zaman `plans.ts`'ten okunur, metne gömülmez.

**0. Üst bar (site-header)**
Amaç: güven + gezinme. Sol logo; orta 5 bağlantı (Ürün, Nasıl çalışır, Güvenlik, Fiyat, SSS); sağ "Giriş" + "14 gün ücretsiz dene". Sticky; scroll'da `bg-white/80 backdrop-blur-md` ve alt 1px çizgi belirir (başta saydam). Mobil: hamburger tam ekran sayfa, CTA altta. Mikro: aktif bölüm `IntersectionObserver` ile alt çizgi.

**1. Hero (imza bölüm)**
Amaç: 5 saniyede "emlak ofisi için, ürün gerçek, ücretsiz dene".
- Düzen (tek karar): ortalı başlık yığını üstte, ürün cihazı altta geniş ve alt kenarda kırpılmış (Linear/Stripe deseni).
- Başlık: "Emlak ofisinizin tüm işi, *tek ekranda.*" (italik serif vurgu). Alt metin: "Müşteri, portföy, randevu, anlaşma ve komisyon tek panelde. Kayıp komisyonunuzu rakamla görün." CTA: "14 gün ücretsiz dene" (birincil) + "Demo görüşmesi planla" (ikincil). Altında: "Kredi kartı gerekmez · Taahhütsüz".
- Zemin: kâğıt rengi + 48px ince ızgara (CSS gradient, maskeyle kenarlarda sönen) + iki radyal ışık (mavi %10, mint %8).
- Ürün illüstrasyonu (saf SVG/HTML/CSS, sunucu bileşeni):
  - Cihaz çerçevesi: 28px yarıçaplı tarayıcı penceresi; üst barda 3 nokta ve adres çubuğu etiketi.
  - Ekran içi: sol dar menü (9 başlık: Bugün, Müşteriler, Portföy, Anlaşmalar, İletişim, Finans, Performans, Araçlar, Ofis), ortada "Bugün" panosu: 3 StatCard, SVG çubuk grafik, talep-portföy eşleşme listesi. Tüm veri açıkça "Örnek ekran" rozetli; gerçek müşteri adı veya başarı iddiası yok.
  - Katmanlar: (1) ızgara + ışık, (2) cihaz `--elev-5`, ≥1024'te `rotateX(4deg)` hafif eğim, (3) cihazın üstüne taşan 3 süzülen kart: "Yeni talep eşleşti" (mint), "Randevu 14:30" (mavi), "Komisyon kaybı uyarısı" (kırmızı, "Profesyonel" rozetli). Farklı `animation-delay`.
  - Alt kenarda cihaz zemin rengine solar (kırpma hissi).
- Mobil: cihaz tam genişlik, süzülen kartlar 2'ye iner ve cihaza yaslı (taşma yok), eğim kapalı.
- Mikro: CTA'da `btn-shine`. LCP öğesi başlık metnidir; ağır görsel dosya yok.

**2. Doğrulanabilir gerçekler şeridi**
Amaç: sahte logo yerine kanıt. 4 hücre, ince bölücü: "14 gün ücretsiz deneme", "27 otomatik görev", "9 iş başlığı", "SMS onaylı dijital imza". Her hücre ilgili bölüme bağlanır (sıfır çıkmaz metrik). Mevcut `CountUp` kalır; mobilde 2x2.

**3. Bento özellik ızgarası (#ozellikler)**
Başlık: "Bir ofisin ihtiyacı olan her şey, birbirine bağlı."
- Masaüstü 12 sütun: A (7x2) Müşteri-talep-portföy eşleştirme (iki sütun nokta + eğri bağlantılar SVG); B (5x1) Randevu ve görevler (mini takvim ızgarası); C (5x1) Komisyon takibi (yığılmış çubuk); D (4x1) Emsal bazlı değerleme (dağılım noktaları); E (4x1) Dijital imza (6 haneli SMS kodu kutuları, Ofis ve üstü); F (4x1) 27 otomatik görev (zaman çizgisi noktaları).
- Tablet: 2 sütun, A tam genişlik. Mobil: tek sütun, A ilk.
- Kart anatomisi: eyebrow, h3, tek cümle, altta illüstrasyon; tüm kart ilgili tur sekmesine gider. Hover: 2px yükselme + mavi kenar.
- Paket etiketi: özellik hangi pakettense küçük rozet (plans.ts ile doğrulanır).

**4. Nasıl çalışır (#nasil)**
3 adım, masaüstünde yatay, mobilde dikey; adımlar arası SVG kesik çizgi yolu; numara dairesi + mini illüstrasyon. 1 "Hesabınızı açın (kartsız, 14 gün)", 2 "Ofisinizi ve ekibinizi tanımlayın", 3 "Eşleşmeleri ve uyarıları izleyin". Adım 2 metni ürün gerçeğine göre doğrulanmalı (içe aktarma yoksa söz verilmez). Süre sözü verilmez. Mikro: scroll'da çizgi çizilir (`stroke-dashoffset`).

**5. Ürün turu sekmeleri (#tur)**
5 sekme: Bugün, Müşteriler, Portföy, Anlaşmalar, Finans. Sekme çubuğu üstte (mobilde yatay kaydırma + snap). Altta tek cihaz çerçevesi; sekme başına ekran: Bugün (görev + randevu), Müşteriler (liste + yan panel), Portföy (kart ızgarası, fotoğrafsız kroki ikonları), Anlaşmalar (kanban sütunları), Finans (komisyon tablosu + çubuk). Teknik: sunucu bileşeni; CSS radyo + `:has(:checked)` ile JS'siz; gerekirse <2KB istemci adası ve `role=tablist`. Tüm ekranlar DOM'da (SEO), biri görünür. "Örnek ekran" rozeti zorunlu.

**6. Kayıp-kaçak hikâyesi (#kayip-kacak, ikinci imza an)**
Başlık: "Kaybettiğiniz komisyonu *rakama dökün.*" Düzen: solda anlatı, sağda anlaşma zaman çizgisi SVG'si: 4 durak (Talep, Gösterim, Teklif, Kapanış); bir dalda kırmızı kesik çizgi ve "Komisyon kayıp riski" etiketi. Tutar/rakam YOK. Zorunlu not: "Yalnız Profesyonel pakette." Amber/kırmızı vurgunun tek yoğun kullanımı; koyu bant ile ritim kırılır. Mikro: kırmızı yol scroll'da çizilir.

**7. Akıllı arama**
Raycast deseni: komut paleti illüstrasyonu (kbd rozetleri, sonuç satırları). Yalnız üründe gerçekten var olan davranış anlatılır; doğrulanamazsa bölüm bento kartına indirilir.

**8. Güvenlik ve KVKK (#guvenlik)**
Koyu lacivert bant. Sol: 3 büyük madde: kiracı verisi izolasyonu (RLS), rol/izin matrisi, KVKK süreç desteği (aydınlatma, rıza, dışa aktarım, silme; İYS/EİDS hazırlık adımları). Sağ: kalkan + kilit SVG, konsantrik halkalar (statik). "KVKK uyumunu garanti eder" YAZILMAZ; "süreç desteği" yazılır.

**9. Fiyat (#fiyat)**
`pricing.tsx` kullanılır; 4 kart, "Ofis" öne çıkan (mavi çerçeve + "EN ÇOK TERCİH"), aylık/yıllık anahtar (%20). Kayıp-kaçak yalnız Profesyonel satırında. Tablet 2x2; mobil dikey, öne çıkan ilk.

**10. SSS (#sss)**
`<details>` ile JS'siz akordeon, 6-8 soru, mevcut içerik ve FAQPage JSON-LD korunur; `summary` en az 48px.

**11. Son CTA**
Koyu bant, ortalı: "Ofisinizde kaybolan fırsatları bugün görün." + birincil düğme + 3 güven maddesi; arka planda koyu ızgara ve tek radyal ışık.

**12. Footer**
5 sütun: Ürün, Paketler, Kaynaklar, Yasal (KVKK, gizlilik, şartlar), İletişim. Sol: logo + tek cümle. Sahte sosyal ikon yok; yalnız gerçek hesaplar varsa.

## (d) Bileşenler ve dosya yapısı

```
src/components/marketing/
  hero/HeroSection.tsx, hero-device.tsx (SVG ekran), hero-floaters.tsx   (sunucu)
  device-frame.tsx             paylaşılan pencere çerçevesi
  proof-strip.tsx              (CountUp mevcut istemci adası)
  bento/BentoGrid.tsx, BentoCard.tsx, bento-art/*.tsx   (kart başına bir SVG)
  how-it-works.tsx
  product-tour/ProductTour.tsx (CSS radyo sekme), screens/*.tsx
  loss-story.tsx, command-palette-art.tsx, security-band.tsx
  section-heading.tsx          (eyebrow + h2 + serif vurgu)
  reveal.tsx                   (yalnız CSS sınıfı sarmalayıcı, JS yok)
src/app/marketing.css          (bu belgenin değişkenleri)
```
`page.tsx` yalnızca bölümleri birleştirir (559 satır -> <120). Veri (paket, SSS, JSON-LD) mevcut yerlerinde kalır.

## (e) Responsive kuralları

- **390:** tek sütun; h1 40px; hero cihazı tam genişlik, 2 süzülen kart; bento tek sütun (A önce); sekmeler yatay kaydırma; CTA tam genişlik; sticky alt CTA çubuğu (safe-area).
- **768:** 2 sütun bento; hero cihazı %92 genişlik; fiyat 2x2; nasıl çalışır 3 dar sütun.
- **1024:** tam 12 sütun bento; cihaz eğimi açılır; 3 süzülen kart; üst bar tam.
- **1440:** içerik max 1200 (hero 1360); yan boşluk büyür; h1 tavanı 80px. Hiçbir kırılımda yatay scroll olamaz.

## (f) Performans bütçesi ve erişilebilirlik

Bütçe: LCP < 2.0 sn (mobil 4G); CLS = 0 (tüm SVG/cihazlara `aspect-ratio`, font fallback `size-adjust`); anasayfa ek istemci JS < 15KB gz; yeni npm bağımlılığı 0; yeni font en çok 1 (Instrument Serif tek stil); görsel dosya 0 (saf SVG); SVG toplamı < 40KB; `will-change` yalnız süzülen kartlarda; aşağı bölümlerde `content-visibility: auto` + `contain-intrinsic-size`; animasyonlar yalnız `transform/opacity`.

Kontrol listesi:
- [ ] Metin kontrastı AA (4.5:1; büyük metin 3:1); `#1463ff` küçük metinde kullanılmaz.
- [ ] `prefers-reduced-motion`: süzülme, çizim, belirme kapalı; içerik görünür.
- [ ] Tek `h1`, h2/h3 sıralı; landmark'lar; skip link.
- [ ] Dekoratif SVG `aria-hidden`; anlamlı olanlara `role="img"` + `aria-label`.
- [ ] Odak halkası 2px, 3:1 kontrast; sekmelerde klavye okları.
- [ ] Dokunma hedefi >= 44px.
- [ ] "Örnek ekran" rozeti tüm illüstrasyonlarda; uydurma rakam/logo/yorum yok.
- [ ] Türkçe karakterler (İ, ı, ş, ğ) başlık fontlarında doğrulandı; `lang="tr"`.
- [ ] Lighthouse mobil: Performans >= 90, Erişilebilirlik >= 95; CLS 0.

## (g) Somut CSS/Tailwind önerileri

```css
/* src/app/marketing.css */
.mk { --mk-bg:#fbfaf7; --mk-bg-2:#f4f2ec; --mk-card:#fff; --mk-line:#e7e3da;
  --mk-grid:rgba(10,34,71,.06); --mk-ink:#071a38; --mk-body:#334155; --mk-muted:#5b6577;
  --mk-accent:#1463ff; --mk-gain:#0e9f8c; --mk-loss:#cf3438;
  --mk-r-card:20px; --mk-r-device:28px; --mk-r-btn:12px;
  --mk-ease:cubic-bezier(.2,.7,.2,1);
  --mk-section-y:clamp(4rem,3rem + 6vw,8rem);
  background:var(--mk-bg); color:var(--mk-body); }
.mk-grid-bg { background-image:
  linear-gradient(var(--mk-grid) 1px,transparent 1px),
  linear-gradient(90deg,var(--mk-grid) 1px,transparent 1px);
  background-size:48px 48px;
  mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 80%); }
.mk-glow { background:
  radial-gradient(600px 400px at 20% 10%,rgba(20,99,255,.10),transparent 70%),
  radial-gradient(500px 380px at 85% 20%,rgba(14,159,140,.08),transparent 70%); }
.mk-h1 { font-family:var(--font-manrope); font-weight:700; letter-spacing:-.035em; line-height:1.04;
  font-size:clamp(2.5rem,1.2rem + 5.2vw,5rem); color:var(--mk-ink); text-wrap:balance; }
.mk-serif { font-family:var(--font-instrument-serif),serif; font-style:italic; font-weight:400; }
.mk-device { border-radius:var(--mk-r-device); background:#fff; border:1px solid var(--mk-line);
  box-shadow:var(--elev-5), var(--inner-top); aspect-ratio:16/10; overflow:hidden; }
@media (min-width:1024px){ .mk-device{ transform:perspective(1600px) rotateX(4deg); } }
.mk-float { animation:mk-float 7s ease-in-out infinite alternate; }
@keyframes mk-float { to { transform:translateY(-8px); } }
@media (prefers-reduced-motion:reduce){ .mk-float,.mk-draw{ animation:none!important; } }
@supports (animation-timeline:view()){
  .mk-reveal{ animation:mk-in linear both; animation-timeline:view(); animation-range:entry 0% entry 40%; }
  @keyframes mk-in{ from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
}
.mk-section { padding-block:var(--mk-section-y); content-visibility:auto; contain-intrinsic-size:auto 720px; }
```

Tailwind eşleniği:
- Kart: `rounded-[20px] border border-[#e7e3da] bg-white shadow-[var(--elev-3)] transition hover:-translate-y-0.5 hover:border-brand-400`
- Bento: `grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5` (A: `lg:col-span-7 lg:row-span-2`; B ve C: `lg:col-span-5`; D/E/F: `lg:col-span-4`)
- Eyebrow: `text-xs font-semibold uppercase tracking-[.14em] text-brand-700`
- Birincil düğme: `min-h-12 rounded-xl bg-brand-600 px-6 font-semibold text-white shadow-[var(--shadow-glow-brand)] hover:bg-brand-700`
- Font: `Instrument_Serif({ variable: "--font-instrument-serif", weight: "400", style: "italic", subsets: ["latin","latin-ext"], display: "swap" })`

Risk ve öneri: Safari'de `animation-timeline` yoksa içerik zaten görünür. Her metin/rakam `plans.ts`, `vercel.json` (27 cron) ve `nav-config.ts`'ten sözleşme testiyle doğrulanmalı (ana sayfa iddia testi eklenmesi önerilir).
