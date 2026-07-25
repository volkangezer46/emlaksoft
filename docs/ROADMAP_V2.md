# EmlakSoft — Program V2

Hedef: Türk mevzuatına uygun, dünyadaki emlak CRM/SaaS özelliklerini barındıran,
satın alınmak istenecek bir ürün.

Bu belge **canlı** bir plandır. İş yapılırken yeni iş bulunursa buraya eklenir.
Her madde ya `[ ]` bekliyor, ya `[~]` devam ediyor, ya `[x]` bitti + doğrulandı.

---

## 0. Kapsam ve sınırlar — önce bunu okuyun

### 0.1 Yasal sınır: veri kazıma (scraping) yapılmayacak

`gecmisi.com.tr`, `Endeksa` ve `Tapusor`'un yeteneklerini "API'siz" elde etmek
pratikte şu üç kaynağı kazımak anlamına gelir ve **üçü de yapılmayacak**:

| Kaynak | Neden yapılmıyor |
|---|---|
| sahibinden.com ilan/fiyat verisi | ToS ihlali; 5846 sayılı FSEK; toplu kişisel veri işlenmesi → KVKK |
| **TAKBİS / tapu kaydı** | Devlet sistemi. Yetkisiz erişim **TCK 243-244 kapsamında suç**. Erişim yalnızca yetkilendirme/e-Devlet ile |
| Portal HTML'i (hepsiemlak/zingat) | ToS ihlali + kırılgan; bir DOM değişikliği tüm veriyi bozar |

### 0.2 Aynı yeteneği yasal zeminde nasıl veriyoruz

Bu tabloyu ürün kararı olarak okuyun — kısıtlama değil, daha savunulabilir bir mimari:

| İstenen yetenek | Bizim yolumuz | Durum |
|---|---|---|
| Fiyat geçmişi (gecmisi.com.tr) | Kendi portföyümüzde **trigger tabanlı** tarihçe. Uygulama koduna bağımlı değil, `properties`'i güncelleyen her yol kapsanır | Temel **hazır** (migration 049) |
| Fiyatın ₺/$/€ tarihsel karşılığı | **TCMB açık veri** — resmî günlük kur, herkese açık ve serbest | Madde V1 |
| Değerleme (Endeksa) | **Emsal motoru**: kendi kapanan işlemleriniz + portföy + ilçe/m² bandı → medyan ₺/m², düzeltme katsayıları. Dış API'ye sıfır bağımlılık | Madde D1 |
| Bölge trendi | Kendi `listing_closures` + `property_price_history` + TÜFE | Madde D2 |
| Kira artış tavanı | TÜFE 12 aylık ortalama — zaten var (`lib/tufe.ts`) | **Hazır** |
| Tapu/parsel sorgusu | Yetkili sağlayıcı API'si (mevcut `tapusor.ts`). Alternatifi yok, kazınamaz | **Hazır (anahtar bekliyor)** |

**Not:** mevcut `endeksa.ts` / `tapusor.ts` entegrasyonları kaldırılmıyor.
D1'den sonra sistem **API olmadan da tam çalışır**; API varsa sonuç zenginleşir.

### 0.3 Gerçekçilik

Bu programın tamamı tek oturumda bitmez. Sıra: **güvenlik/bozuk şeyler → görünür
kalite → yeni yetenek → yaygınlaştırma**. Her turda doğrulanmış artış teslim
edilir; yarım iş push edilmez.

---

## 1. Temizlik ve güvenlik (F)

- [x] **F1** ~~`.npmrc` → `engine-strict=true`~~ **DENENDİ, GERİ ALINDI.**
      CI'ı tamamen kırdı: `@img/sharp-win32-ia32@0.35.3` kendi package.json'unda
      `engines: {"node":"^20.9.0"}` bildiriyor (caret → `<21`, Node 24'ü dışlar).
      Paket optional + win32/ia32, yani hiç kurulmuyor; ama engine-strict
      lockfile metadata'sını doğruladığı için `npm ci` Linux runner'da patlıyor.
      Karar: kapı kaldırıldı. Node sürümü zaten `.nvmrc` (CI okuyor) +
      `engines` uyarısıyla korunuyor. Gerekçe `.npmrc` içinde yazılı.
- [ ] **F2** `scripts/apply-migrations.ts` bozuk: sabit listede **9** migration
      var, diskte **54**. `npm run db:migrate` 10–54'ü sessizce uygulamıyor.
  - [ ] Dizini tarayıp ada göre sıralayan sürüme çevir
  - [ ] Uygulanan migration'ları izleyen `schema_migrations` tablosu ekle
        (şu an hiçbir izleme yok — neyin uygulandığı bilinmiyor)
  - [ ] `--dry-run` ve tek dosya modu
- [ ] **F3** 12 yüksek önemli güvenlik açığı, hepsinde fix var:
  - [ ] `sharp`/libvips — CVE-2026-33327/33328/35590/35591 (Next Image kullanıyor, **çalışma zamanı riski**)
  - [ ] `postcss` — CSS stringify XSS
  - [ ] `brace-expansion` — DoS (OOM)
  - [ ] Kalan 9 ESLint zinciri (devDependency, çalışma zamanı riski yok)
- [ ] **F4** `.env.local.example`'a eksik değişkenleri ekle (`CRON_SECRET` zorunlu
      — **7 cron route** ona bağlı, yoksa hepsi sessizce çalışmaz)
- [ ] **F5** Sır rotasyonu notu: `service_role` + DB şifresi sohbette paylaşıldı

## 2. Tema ve görsel kalite (T)

Hedef: "yeterince profesyonel değil" geri bildirimini kapatmak. Yaklaşım
**sistem düzeyinde** — tek tek sayfa süslemek değil, token + paylaşılan bileşen
katmanını yükseltip iyileşmenin kendiliğinden yayılmasını sağlamak.

- [ ] **T1** Premium token katmanı
  - [ ] Yükseklik (elevation) skalası: yüzey katmanları arası tutarlı ışık/gölge
  - [ ] Yüzey varyantları: `surface-raised`, `surface-sunken`, cam (glass) katman
  - [ ] Kenarlık kalitesi: tek renk çizgi yerine ince gradient/iç gölge kenarlar
  - [ ] Odak halkası: marka rengiyle çift katman (a11y + estetik)
  - [ ] Tipografi skalası: display/heading/body için tutarlı ölçek ve satır aralığı
  - [ ] Mikro-etkileşim: hover/active için ölçek+gölge+parlaklık üçlüsü
- [ ] **T2** Paylaşılan bileşenleri yeni katmana bağla → tüm panele yayılır
  - [ ] `Badge` / `StatusBadge`
  - [ ] `DataTable` (satır hover, başlık, sayfalama kontrolleri)
  - [ ] `ChartFrame` + grafik eksen/ızgara/tooltip
  - [ ] `dialog` (başlık, gövde, footer)
  - [ ] `stat-card`, `empty-state`, `skeleton`
- [ ] **T3** Sayfa şablonları
  - [ ] Hero/başlık bloğu tek bileşene indirgenmeli (şu an her sayfada kopyalanıyor)
  - [ ] Liste sayfası şablonu (başlık + filtre + tablo + boş durum)
  - [ ] Detay sayfası şablonu (özet şerit + sekmeler + yan panel)
- [ ] **T4** Koyu tema (`.theme-dark` iskeleti var, tamamlanmadı)
- [ ] **T5** Yazdırma/PDF görünümü (sözleşme, teklif, portföy broşürü)

## 3. Fiyat geçmişi ve para birimi (V)

- [ ] **V1** TCMB kur altyapısı
  - [ ] `tcmb_rates` tablosu (tarih, USD, EUR, kaynak, çekilme zamanı)
  - [ ] Günlük cron — TCMB resmî XML (15:30 sonrası yayınlanır)
  - [ ] Tarihsel geri dolum (backfill) scripti
  - [ ] Tatil/hafta sonu: en yakın önceki iş günü kuruna düşme
- [ ] **V2** Fiyat geçmişinde çoklu para birimi
  - [ ] Her kaydın o günkü resmî kurla ₺/$/€ karşılığı
  - [ ] Para birimi seçici; grafik seçilen birimde
  - [ ] "₺ bazında arttı ama $ bazında düştü" içgörüsü — Türkiye için kritik
- [ ] **V3** Fiyat değişim uyarıları
  - [ ] Takip edilen portföyde fiyat düşüşünde bildirim
  - [ ] Müşteri talebine uyan portföyde indirim → otomatik eşleşme bildirimi
- [ ] **V4** Portföy fiyat sağlığı: piyasa medyanına göre konum (pahalı/uygun)

## 4. Değerleme ve piyasa zekâsı (D) — API'siz

- [ ] **D1** Emsal (comparable) motoru
  - [ ] SQL fonksiyonu: ilçe + tip + m² bandı + oda → medyan/çeyrek ₺/m²
  - [ ] Düzeltme katsayıları: kat, yaş, ısıtma, cephe, asansör, otopark
  - [ ] Güven skoru (emsal sayısı + yayılım) — az veriyle "emin" görünmemeli
  - [ ] Kapanan işlemler > aktif ilanlar ağırlığı (gerçekleşen fiyat daha değerli)
- [ ] **D2** Bölge trendi: ilçe/mahalle bazlı ₺/m² zaman serisi
- [ ] **D3** Değerleme raporu (PDF): emsaller, düzeltmeler, aralık, imza alanı
- [ ] **D4** Kira çarpanı / getiri (yield) analizi
- [ ] **D5** Satış süresi tahmini (kendi kapanma verinizden)
- [ ] **D6** Talep-arz ısı haritası (ilçe bazlı talep/portföy dengesi)

## 5. Hız (P) — "en iyi seviye"

- [ ] **P1** Ölçüm önce: bundle analizi, en ağır rotalar, First Load JS tablosu
- [ ] **P2** N+1 sorgu avı — server action'larda döngü içi sorgu taraması
- [ ] **P3** Index kapsamı: her sık filtre/sıralama için index doğrulaması
  - [ ] `explain analyze` ile en yavaş 10 sorgu
- [ ] **P4** Streaming/Suspense: ağır panelleri kabuk sonrası akıt
- [ ] **P5** `use cache` / ISR: değişmeyen veriyi (geo, tanımlar, planlar) önbellekle
- [ ] **P6** Görsel: `next/image` boyut disiplini, LQIP/blur, AVIF
- [ ] **P7** Yazı tipi: subset + `size-adjust` ile CLS sıfırlama
- [ ] **P8** Prefetch stratejisi: sidebar rotaları için akıllı ön yükleme
- [ ] **P9** RSC payload küçültme: gereksiz `"use client"` sınırlarını geri çekme
- [ ] **P10** Lighthouse/Core Web Vitals hedefi: LCP < 1.8s, INP < 200ms, CLS < 0.05

## 6. Paylaşılan altyapıyı yaygınlaştırma (U)

- [ ] **U1** `DataTable` → 11 sayfa hâlâ ham `<table>` (yalnızca `teklifler` taşındı)
- [ ] **U2** Radix `dialog` → **26 dosya** elle dialog kuruyor, primitive hiç kullanılmıyor
- [ ] **U3** `Select` → native `<select>` kullanan formlar
- [ ] **U4** `Tabs` → müşteri 360, portföy detay, ayarlar
- [ ] **U5** `Tooltip` → `title=""` kullanan yerler

## 7. re-os.com özellik paritesi (R)

Araştırıldı. Bizde **olmayan** ve eklenmesi gerekenler:

- [ ] **R1** Ofis web sitesi (site builder) — `vitrin/[slug]` bir başlangıç
  - [ ] Tema seçimi, alan adı bağlama, SEO alanları
  - [ ] 360° tur + YouTube gömme
  - [ ] WhatsApp iletişim widget'ı
- [ ] **R2** **MLS / Portföy-Talep havuzu** — ofisler arası paylaşım (şu an tenant içi)
  - [ ] Havuza açma/çekme, komisyon paylaşım anlaşması
  - [ ] Çapraz ofis eşleştirme
- [ ] **R3** **GİB BTRANS raporlama** — Taşınmaz Ticareti Yönetmeliği zorunluluğu
- [ ] **R4** EİDS entegrasyonu tamamlama (iskelet var)
- [ ] **R5** Çok dilli ilan: otomatik çeviri (mevcut OpenAI katmanı üzerine)
- [ ] **R6** Telefon CRM: gelen aramada arayanı tanıma, çağrı sırasında not
- [ ] **R7** Uluslararası portal yayını (ListGlobally/Properstar sınıfı)
- [ ] **R8** Franchise/çok markalı ofis yönetimi (route var, içerik zayıf)
- [ ] **R9** Referans ağı: ofisler arası müşteri yönlendirme + komisyon
- [ ] **R10** Mobil: PWA var → push + offline derinleştirme

## 8. Kendi eklediğim olağanüstü özellikler (X)

Rakiplerde görmediğim, gerçek acıyı çözen ve savunulabilir olanlar:

- [ ] **X1** **Portföy sağlık skoru** — fiyat/görsel/açıklama/yetki süresi/portal
      durumunu tek skora indir, "bu portföy neden satmıyor" sorusunu cevapla
      (`property-health.ts` var, derinleştirilecek)
- [ ] **X2** **Kaçan fırsat radarı** — kapanan/kaybedilen işlemlerden desen
      çıkarıp "bu talebi kaçırma" uyarısı (`lost-sale-detector.ts` temeli var)
- [ ] **X3** **Danışman koçu** — KPI'lardan kişiselleştirilmiş haftalık aksiyon
      listesi ("bu hafta 3 soğuk lead'i ara, 2 portföyün fiyatı piyasa üstü")
- [ ] **X4** **Sözleşme risk taraması** — sözleşme metninde eksik zorunlu madde,
      tarih tutarsızlığı, komisyon oranı mevzuat sınırı kontrolü
- [ ] **X5** **KVKK otomatik yaşam döngüsü** — rıza süresi dolan müşteri verisini
      otomatik anonimleştirme + silme kanıtı (denetimde altın değerinde)
- [ ] **X6** **Çift kayıt (duplicate) füzyonu** — aynı müşteri/portföyün farklı
      danışmanlarca girilmiş kopyalarını bulup birleştirme
- [ ] **X7** **Komisyon simülatörü** — kapanış öncesi net eline geçecek tutar
      (stopaj, KDV, ofis payı, split) — danışman güveni
- [ ] **X8** **Anlaşma olasılık skoru** — aşama, yaş, aktivite yoğunluğu,
      müşteri sıcaklığından kapanma olasılığı
- [ ] **X9** **Zaman tüneli** — bir portföyün/müşterinin tüm yaşam öyküsü tek
      dikey akışta (fiyat, portal, görüşme, teklif, ziyaret)
- [ ] **X10** **Denetim moduna hazırlık paketi** — mevzuat denetiminde istenen
      tüm evrakı tek tuşla ZIP
- [ ] **X11** **Ofis kıyaslama (benchmark)** — anonim toplu veriyle "sizin
      dönüşüm oranınız benzer ofislerin %X'i kadar"
- [ ] **X12** **Klavye-öncelikli operasyon** — komut paleti var; her kritik
      aksiyona kısayol (güç kullanıcı verimliliği)

## 9. Kalite güvencesi (Q)

- [ ] **Q1** Test altyapısı **hiç yok** — birim/E2E framework kurulmalı
  - [ ] Vitest + kritik `lib/` fonksiyonları (permissions, valuation, tufe, clock)
  - [ ] Playwright + kritik akış (giriş, portföy ekle, teklif, sözleşme imza)
- [ ] **Q2** RLS politika testleri — tenant sızıntısı en büyük SaaS riski
- [ ] **Q3** CI'a `npm audit --audit-level=high` kapısı
- [ ] **Q4** Hata izleme (Sentry sınıfı) — şu an prod hatası görünmüyor
- [ ] **Q5** Yedekleme/geri yükleme provası

---

## Doğrulama kuralı

Her madde şu üçü geçmeden `[x]` işaretlenmez:

```
tsc --noEmit            → exit 0
eslint . --max-warnings=0 → exit 0
next build              → exit 0
```

Migration içeren maddelerde ek olarak: uygulanan şema, canlı DB'de sorgu ile
doğrulanır (varsayımla geçilmez).
