> **ARŞİV — güncel kaynak: docs/ROADMAP.md** (durum: docs/DURUM.md, deploy: docs/DEPLOY.md). Bu belge tarihsel kayıttır; sayılar ve talimatlar eskimiş olabilir.

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
- [x] **F2** `scripts/apply-migrations.ts` düzeltildi — artık dizini tarayıp ada
      göre sıralıyor (`listMigrations()`), uygulanan sürümleri kendi oluşturduğu
      `public.schema_migrations` tablosunda izliyor, düzenlenmiş dosyalarda
      checksum uyuşmazlığını yakalıyor, `--dry-run`/`--baseline`/`--only`
      destekliyor. Birincil yol: veritabanı dahil migration doğrulaması, read-only
      dry-run, restore edilebilir backup/PITR kontrolü ve ardından kontrollü
      `npm run db:migrate`. Ledger drift varsa uygulama yapılmaz.
- [~] **F3** Güvenlik açıkları — **BÜYÜK ÖLÇÜDE KAPANDI.** `package.json`'da
      `overrides: { sharp: "^0.35.3", postcss: "^8.5.23" }` eklendi, `npm audit
      --audit-level=high --omit=dev` → **0**. Kalan tek açık (`brace-expansion`
      via `eslint`→`minimatch@3`) salt devDependency, çalışma zamanı riski yok.
      CI'da `npm ci`'ın bu override'larla yeşil olup olmadığı teyit edilmedi
      (bu ortamdan `gh`/Actions log erişimi yok) — kullanıcı bir sonraki push'ta
      CI'ı kontrol etmeli.

  **Geçmiş (neden zordu):** `overrides: { sharp, postcss }` daha önce 5 push
  boyunca CI'da `npm ci`'ı kırmıştı, kök sebep asla netleşmedi (GitHub Actions
  log erişimi bu ortamdan hep 403). O override şu an package.json'da duruyor ve
  yerel `npm audit --omit=dev` temiz — **ama bu haliyle CI'da yeşil olduğu
  henüz tekrar teyit edilmedi**, aynı sınıf hata sessizce geri dönmüş olabilir.
  - [ ] Kullanıcı bir sonraki push'ta Actions sekmesinden `npm ci` adımını
        kontrol etmeli.
- [x] **F4** `.env.example` zaten güncel — cron route'larının kullandığı tüm
      değişkenler (`CRON_SECRET`, `NODE_ENV`, `NEXT_PUBLIC_APP_URL`) belgeli.
      (Not: dosya adı `.env.local.example` değil `.env.example`.)
- [ ] **F5 — YAYIN BLOKERİ:** Public Git geçmişindeki aktif legacy `service_role` için yeni
      `SUPABASE_SECRET_KEY` üret; yerel/Vercel ortamlarını değiştir, legacy anahtarı ve DB
      parolasını döndür, eski anahtarın reddedildiğini doğrula; ardından koordineli Git geçmişi
      temizliği ve taze clone zorunluluğu uygula.

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
- [x] **T4** Koyu tema — **UYGULANDI, SONRA KULLANICI İSTEĞİYLE GERİ ALINDI.**
      Token katmanı hazırdı ama `--ink-950` **aşırı yüklü**: hem ana metin rengi
      (760 kullanım) hem koyu buton zemini. Token'ı bölmek 800+ dosya
      düzenlemesi demek; utility sınıflarını tema kapsamında geçersiz kılan
      ~15 CSS kuralıyla çözülmüştü (varsayılan kapalı, tema seçici + parlama
      önleyici betik). Kullanıcı gerek olmadığını belirtti; **hiç iz bırakmadan
      geri alındı** (doğrulandı: `data-theme`/`ThemeToggle`/`ThemeScript` sıfır).
- [ ] **T5** Yazdırma/PDF görünümü (sözleşme, teklif, portföy broşürü)

## 3. Fiyat geçmişi ve para birimi (V)

- [x] **V1** TCMB kur altyapısı — `tcmb_rates` tablosu (migration 000050),
      günlük cron `api/cron/tcmb-kur`, `scripts/tcmb-backfill.ts` (`npm run
      kur:backfill`), tatil/hafta sonu düşmesi `tcmb_rate_on()` SQL fonksiyonu
      + `fetchLatestTcmbRate(7)` (7 gün geriye bakar).
- [x] **V2** Fiyat geçmişinde çoklu para birimi — `property-price-history.tsx`
      TRY/$/€ seçici, `price-history.ts` + `property_price_history_fx` view
      her satırı kendi günün TCMB kuruyla dönüştürüyor; "₺ arttı $ düştü"
      içgörüsü gerçek (para birimine göre bağımsız hesap).
- [x] **V3** Fiyat değişim uyarıları — `vitrin-alert-notify.ts` (takip edilen
      portföy düşüşü → ofis bildirimi) + `notifyPriceDropToMatchingDemands`
      (`actions/properties.ts`, indirim → eşleşen talep sahiplerine bildirim).
- [x] **V4** Portföy fiyat sağlığı — `comparables.ts`'teki `pricePosition()`/
      `healthFromDeviation()` gerçek emsal medyanına göre "piyasa üstü/altı/
      seviyesinde" döndürüyor, portföy sayfasında gösteriliyor.

## 4. Değerleme ve piyasa zekâsı (D) — API'siz

- [x] **D1** Emsal (comparable) motoru — `find_comparables()` SQL fonksiyonu
      (migration 000051 + 20260803000010): ilçe+tip+m² bandı → medyan/çeyrek
      ₺/m², güven skoru, kapanan işlem ağırlığı, **kat/yaş/ısıtma/cephe
      düzeltme katsayıları** (`comparable_feature_desirability()`, ±%15
      sınırlı). **Asansör/otopark kapsam dışı** — `properties.features`
      şemasında hiç yakalanmıyor (form alanı yok); eklemek ayrı bir
      form/şema değişikliği ister.
- [x] **D2** Bölge trendi — `/app/bolge-analizi` + `api/cron/bolge-snapshot`.
- [x] **D3** Değerleme raporu — emsaller ✓, aralık ✓, imza alanı ✓, **düzeltmeler ✓**
      (`/app/degerleme/[id]/page.tsx`). Tablo artık "Düzeltilmiş ₺/m²" +
      farklıysa "ham: X" alt notu gösteriyor; `estimate_property_value` de
      medyan/çeyrek hesabını düzeltilmiş değerler üzerinden yapıyor (yalnız
      kozmetik değil, tahminin kendisi iyileşti). Canlı Playwright ile
      doğrulandı: hedef (zemin üstü kat, 30 yaşında, kombi, cephesiz) için
      87.273 ₺/m² → 82.037 ₺/m² (×0,94, matematik doğrulandı).
      `resolvePriceHealth`'e de aynı düzeltme parametreleri eklendi
      (properties.ts create/update + portal-teyit cron) — tutarlı tek karar
      noktası.
- [x] **D4** Kira çarpanı / getiri (yield) analizi
- [x] **D5** Satış süresi tahmini (kendi kapanma verinizden)
- [x] **D6** Talep-arz ısı haritası — `/app/raporlar/talep-arz` + `talep-arz.ts`
      `aggregateTalepArz()`, ilçe bazlı medyan bütçe/fiyat + kapsam oranı +
      harita.

## 5. Hız (P) — "en iyi seviye"

- [x] **P1** Ölçülüp spekülatif iş yapılmadı — `recharts` yalnızca 4 sayfada,
      paylaşılan kabukta değil, kanıtlanabilir kazanç yok (bkz. §11).
- [x] **P2** N+1 sorgu avı — server action'larda döngü içi sorgu taraması
  - Tarama: baskın desen zaten batch-sorgu + bellekte toplama (`.in()` + Map). Kalan
    sıralı döngüler kasıtlı (WhatsApp rate-limit, cron düşük hacim). Tek gerçek offender
    düzeltildi: `abonelik-kontrol` cron'u satır başına 3 yazma → küme başına 3 toplu yazma.
- [~] **P3** Index kapsamı — kritik filtre/sıralama kombinasyonları için
      composite/GIN index'ler zaten var (`idx_customers_tenant_active`,
      `idx_properties_tenant_status_created`, `idx_demands_tenant_status_created`
      vb.). Dev DB çok küçük (onlarca satır) olduğu için planlayıcı gerçek
      kullanımda kanıt vermiyor (her sorguda Seq Scan — bu boyutta doğru
      davranış). `explain analyze` ile en yavaş 10 sorgu prod ölçeğinde hâlâ
      doğrulanmadı.
- [ ] **P4** Streaming/Suspense: `/app` dashboard'da tek kullanım var
      (`<Suspense><BriefingAiLine/></Suspense>`); ağır liste sayfaları
      (`musteriler` 14 sorgulu `Promise.all`, `portfoyler`) tamamen senkron —
      kabuk, veri hazır olana kadar hiç akmıyor.
- [x] **P5** `use cache` / ISR — `geo.ts` (`unstable_cache`, 15dk TTL,
      `revalidateTag`), `definitions.ts`, `office-score.ts`, `admin-badges.ts`.
- [x] **P6** Görsel disiplini — 20 `<Image>` kullanımının tamamı `fill+sizes`
      veya açık `width`/`height` taşıyor.
- [x] **P7** Yazı tipi — `Manrope`/`Inter`/`Geist_Mono` hepsi
      `subsets:["latin"]`, `display:"swap"`, gereksiz ağırlık preload edilmiyor.
- [x] **P8** Prefetch stratejisi — sidebar linkleri `onMouseEnter`/`onFocus` ile
      `router.prefetch()` çağırıyor; bu oturumda eklenen
      `staleTimes:{dynamic:30}` ile birleşince "hover'da ön-yükle, 30sn içinde
      anında navigasyon" stratejisi tamamlanıyor.
- [ ] **P9** RSC payload küçültme — geri çekilmemiş büyük `"use client"`
      bileşenleri: `property-media-manager.tsx` (897 satır),
      `investment-analyzer.tsx` (832), `advisor-chat.tsx` (637),
      `playbooks-manager.tsx` (626), `calculator.tsx` (595),
      `command-search.tsx` (569).
- [ ] **P10** Lighthouse/Core Web Vitals hedefi — CI'da hiçbir CWV kapısı yok.

## 6. Paylaşılan altyapıyı yaygınlaştırma (U)

- [x] **U1** `DataTable` — tüm liste tabloları paylaşılan katmanda
- [x] **U2** Radix `dialog` — 24 elle kurulum → 4. Kalan 4'ün hiçbiri form
      dialogu değil (kanban paneli, mobil çekmece, sayfa içi panel, sarmalayıcının
      kendisi). **13 dialogda Esc tuşu hiç çalışmıyordu**; Esc'i elle yazmış olan
      10'unda da focus trap ve scroll lock yoktu.
- [x] **U3** Uzun listeler `Combobox`'a (8 dosya) — ilçe/mahalle/müşteri/portföy.
      Sunucu taraflı arama var: liste `.limit(100)` ile kirpılıyordu.
      Kısa listelerde native `<select>` **bilinçli olarak kalıyor** (bölüm 11).
- [x] **U4** `Tabs` — müşteri 360'ın 8 sekmesi Radix'e. Eksik olanlar:
      `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, ok tuşlarıyla gezinme.
- [x] **U5** `Tooltip` — ikon-only butonlarda `title=""` → `<Tip>` + `aria-label`.
      Native `title` klavye odağında açılmıyor, dokunmatikte hiç görünmüyor ve
      ekran okuyucularda tutarsız okunuyor. Aidat formunda iki tarih alanının
      **tek etiketi `title`'dı**; gerçek `<label>` ile değiştirildi.

## 7. re-os.com özellik paritesi (R)

Araştırıldı. Bizde **olmayan** ve eklenmesi gerekenler:

> **Kod taraması yapıldı.** Gerçekten eksik olanlar: **R2** (kiracılar-arası
> havuz), **R3** (GİB BTRANS), **R7** (uluslararası portal), **R9** (referans
> ağı). Dördü de **dış girdi olmadan sorumlulukla yazılamaz**: R3 resmî
> entegrasyon spesifikasyonu, R7 ticari anlaşma, R2 ve R9 ise kiracılar-arası
> veri paylaşımı mimarisi ve sözleşme modeli kararı gerektiriyor. Spekülatif
> iskele kurmak yerine bekletiliyor.

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
- [x] **R8** Franchise/çok markalı ofis yönetimi — dönem filtreli şube rollup,
      şube kıyaslama grafikleri, lider şube rozeti, şube bazlı kayıp-kaçak
      kırılımı; "içerik zayıf" notu artık geçerli değil.
- [ ] **R9** Referans ağı: ofisler arası müşteri yönlendirme + komisyon
- [ ] **R10** Mobil: PWA var → push + offline derinleştirme

## 8. Kendi eklediğim olağanüstü özellikler (X)

Rakiplerde görmediğim, gerçek acıyı çözen ve savunulabilir olanlar:

> **Önce kod taraması yapıldı.** X7'yi "yok" varsayarak yazmaya başladım,
> meğer `commission-simulator.tsx` zaten vardı. İkinci bir kopya eklemek
> yanlış olurdu. Tarama sonucu: **X1** (`property-health.ts`), **X2**
> (`lost-sale-detector` → `kayip-satis` sayfası), **X7**, **X8**
> (`deals.probability`), **X9** (`communication-timeline`), **X12** (komut
> paleti) kısmen mevcut. **X4** ve **X6** gerçekten yoktu.

- [ ] **X1** **Portföy sağlık skoru** — `property-health.ts` fiyat/görsel/portal
      kontrollerini yapıyor ama **açıklama kontrolü skora hiç girmiyor**
      (yalnız portal-yayını-varken çalışan ayrı `computeListingQuality`'de var)
      ve **yetki süresi yalnız "girildi mi" bakıyor, süresi geçmiş/yaklaşan
      hiç kontrol edilmiyor**. Ayrıca yalnız tek portföy detay sayfasında
      gösteriliyor. "Neden satmıyor" sorusunu zaten `sale-diagnostics.ts`
      (`diagnoseSaleBlockers`) cevaplıyor — roadmap bu modülü X1'e hiç
      saymamış, aynı sayfada zaten render ediliyor.
- [x] **X2** **Kaçan fırsat radarı** — ofis geneli desen artık canlı talebe
      bağlanıyor: `computeFragileDealType()` (kapanan işlemlerden "satılık mı
      kiralık mı daha kırılgan" çıkarır, min 4 kapanış + kayıp oranı ≥ %50 —
      `buildLossInsights`'ın #4 içgörüsüyle AYNI eşik, tek kaynak) artık
      `detectLostSaleRisks`'e 4. kural olarak geçiriliyor: ilk 3 kuraldan
      hiçbirine girmeyen ama kırılgan türde aktif talebi olan müşteri
      "warning" seviyesinde yeni bir sebeple (`fragile_deal_type`) işaretlenir.
      6 birim testle + canlı doğrulamayla (geçici test anlaşması eklenip
      silinerek) kanıtlandı.
- [x] **X3** Danışman koçu — 18 test. Sayfa doğru sayıları gösteriyordu ama
      "bu hafta ne yapmalıyım" sorusunu cevaplamak danışmanın işiydi.
      **En fazla 4 madde** (onbirlik liste kimsenin okumadığı listedir),
      **her öneri ölçülebilir bir sayı içerir** (bir test bunu zorluyor),
      **liste hiç boş kalmaz**, huni kopması **tek öneriye** indirilir.
      Yetki belgesi uyarısı her şeyin önünde — mevzuat riski bir dönüşüm
      oranı tavsiyesinin altında kalamaz.
- [x] **X4** Sözleşme risk taraması — 8 mekanik kontrol, 24 test.
      Şablonlar `___` yer tutucuyla geliyor ve doldurulmamış bir şablonu imzaya
      göndermek sahada en sık hata; **hiçbir kontrol yoktu**. Seviye bağlama göre:
      boş alan taslakta uyarı, imzaya gitmişse hata. Komisyon sınırı uyarısı
      **hukuki hüküm kurmuyor**, teyide yönlendiriyor.
- [x] **X5** KVKK yaşam döngüsü — canlı doğrulanmış.
      **Bulgu:** `deleted_at` yalnızca 2 tabloda ve **hiçbir şey temizlemiyordu** —
      "silinmiş" bir müşterinin adı/telefonu/e-postası süresiz duruyordu.
      **Gerçek silme zaten mümkün değil:** `deals`/`calls` FK'ları kısıtlayıcı ve
      ticari kayıtlar TTK gereği saklanmak zorunda → anonimleştirme.
      **Denormalize kopyalar** (`campaign_recipients`, `open_house_visitors`)
      dahil — atlanırsa anonimleştirme sahte olur.
      Canlı testte **3 şema hatası** ortaya çıktı ve düzeltildi
      (`iys_consents.status` 'revoked' kabul etmiyor, `calls.phone` NOT NULL +
      format kısıtlı, `customers.address_line` yok).
- [~] **X6** Çift kayıt — **tespit yapıldı** (`/app/musteriler/cift-kayit`).
      Üç sinyal: telefon (normalize, neredeyse kesin) · e-posta · ad soyad
      (tek başına kanıt değil). Her kayıtta aktivite sayısı gösteriliyor,
      en dolu kayıt işaretli.
      **Birleştirme bilinçli olarak yapılmadı**: alt kayıtları (talep, randevu,
      çağrı, görüşme, anlaşma, teklif, sözleşme, görev) taşıması gereken geri
      alınamaz bir işlem; yanlış eşleşmede veri kaybı demek.
- [x] **X7** Komisyon simülatörü — **kısmen zaten vardı**, eksikleri kapatıldı.
      Yeni bir kopya yazmak yerine mevcut bileşen okundu ve düzeltildi:
      **KDV dahil modu yoktu** (müşteri "180.000 KDV dahil" dediğinde yanlış
      rakam), KDV oranı **üç ayrı yerde** sabitti, "elime ne geçecek"
      sorusuna cevap vermiyordu. `lib/commission.ts` + 19 test.
- [x] **X8** Anlaşma kapanma tahmini — 18 test. `deals.probability` **yalnızca
      aşamadan** türetiliyordu (20/40/60/100), yani aşamanın sayıya çevrilmiş
      hâliydi. 60 günlük, 40 gündür dokunulmamış bir anlaşma ile dün teklif
      gelmiş bir anlaşma aynı %60'ı gösteriyordu.
      Yeni hesap: teklif · görüşme · **hareketsizlik** · yaş · fiyat açığı.
      Kullanıcının girdisi **üzerine yazılmıyor** — asıl değer ikisinin
      farkında. Kural tabanlı olduğu, istatistiksel model olmadığı panelde yazılı.
- [x] **X9** Zaman tüneli (portföy) — yedi kaynağı tek kronolojide birleştirir:
      fiyat · durum · portal yayın/kaldırma · randevu · teklif · açık ev · medya.
      Fiyat ve durum geçmişi ayrı iki bölümdü; portal, teklif, randevu ve açık ev
      **hiçbir kronolojide görünmüyordu**. Portal satırı iki olay üretir
      (yayın + kaldırma); medya güne göre toplanır — 40 fotoğraf tek başına
      kronolojiyi doldururdu.
      Müşteri tarafı için `communication-timeline` zaten vardı.
- [x] **X10** Denetim dosyası — yetki belgeleri, sözleşmeler, hizmet bedeli ve
      İYS rızaları **beş ayrı sayfaya** dağılmıştı. Tek yazdırılabilir sayfa.
      **ZIP bilinçli olarak yok:** bir bağımlılık ister ve denetmen evrakı
      ekranda/kağıtta ister. **Eksikleri de gösteriyor** (yetkisiz portföy,
      süresi geçmiş yetki, rızasız müşteri) — yalnızca iyi tarafı gösteren bir
      denetim dosyası hazırlık değil, kendini kandırmadır.
- [ ] **X11** Ofis kıyaslama — **KULLANICI KARARI BEKLİYOR.** Kiracılar-arası
      anonim veri toplama mimarisi ve sözleşme modeli kararı gerektiriyor
      (R2/R9 ile aynı karar). Spekülatif iskele kurulmadı.
- [x] **X12** Klavye kısayolları — Ctrl+K vardı ama **tek kısayol oydu**.
      10 gidiş kısayolu + `?` yardım penceresi.
      **`g` önekli iki tuş, tek harf değil:** tek harfli kısayol bir nota yazarken
      odak kaybolursa sayfayı değiştirip yazılanı kaybettirir. Girdi alanında
      hiçbir kısayol çalışmıyor + 1,2 sn zaman aşımı.

## 9. Kalite güvencesi (Q)

- [x] **Q1a** Vitest kuruldu, **84 birim testi** yeşil, CI'a bağlandı
  - `tr-text` (20) · `pgrst` (13) · `phone` (25) · `permissions` (16) · `lead-score` (15)
  - Kapsam bilinçli: bileşenleri jsdom altında render etmek RSC sınırını taklit
    etmek demek — kırılgan ve düşük getirili. Testler saf mantıkta.
  - **Testin bulduğu:** `hasPermission` asimetrisi — boş rol advisor yetkisi
    alıyor, hatalı rol hiç yetki almıyor. Davranış korundu, gerekçesi yazıldı.
- [~] **Q1b** Playwright altyapısı gerçek: 8 dosya, 43 test, gerçek girişle
      `auth.setup.ts`. Ama roadmap'in istediği 4 akıştan yalnız **girişin**
      spec kapsamı var — **portföy ekle, teklif, sözleşme imza için hiç test
      yok** (grep'te "teklif"/"imza" hiç geçmiyor). MASTER_PLAN.md'nin "fiilen
      kapandı" notu bu ölçütle iyimser.
- [x] **Q2** RLS denetimi — `npm run db:rls-audit`. İlk koşuda **gerçek bir
      hata buldu**: `tasks` ve `property_media` normal kullanıcıya görünmüyordu
      (bkz. 10.6). Şu an 39 tablo, bulgu yok.
- [x] **Q6** Server Action yetki kapısı denetimi — `npm run audit:actions`, CI'da.
      **Gerçek bir açık buldu**: `notifyTenant` `"use server"` dosyasından export
      edildiği için çağırılabilir bir uç noktaydı, `tenantId`'yi parametre alıyor
      ve `service_role` kullanıyordu — yani RLS'i atlayarak herhangi bir
      kiracıya bildirim yazılabiliyordu. `lib/notify.ts`'e taşındı.
      192 action, 17 gerekçeli muafiyet, bulgu yok.
- [x] **Q3** Bağımlılık açığı kapısı — `continue-on-error` **kaldırıldı**, CI
      artık blokluyor. Düz `npm audit --audit-level=high` CI'ı **kalıcı
      kırmızı** yapardı (12 high, 9'u dev-only; 3'ü Next'in kendi iç
      bağımlılıklarında ve npm'in "fix"i Next 16 → 9.3.3 düşürmek).
      Kapı 3'ü **gerekçesiyle** bekletiyor, yeni her açıkta kırıyor.
      Deneyle doğrulandı: istisna kaldırılınca exit 1, geri konunca exit 0.
- [x] **Q4** Üretim hata kaydı — `/admin/hatalar`. **Bağımlılıksız**: Sentry
      sınıfı bir servis ücretli bir karar olduğu için DB tabanlı çözüm seçildi.
      Aynı parmak izi yeni satır değil **sayaç** artışı üretiyor; mesajdaki uuid
      ve uzun sayılar maskeleniyor ("Customer 8f3a… not found" ile
      "Customer b21c… not found" tek hata).
      **Kendi kodumda bir hata buldu**: ilk migration RLS politikasını kurdu
      ama `GRANT` vermedi — `service_role` tabloya yazamıyordu (42501) ve
      `logError` hatayı yuttuğu için hiçbir iz yoktu. Bundan çıkan ders koda
      işlendi: supabase-js hata **fırlatmaz, döndürür** — artık dönen hata da
      kontrol ediliyor ve süreç ömründe en fazla bir uyarı basılıyor.
- [ ] **Q5** Yedekleme/geri yükleme provası

---

## 10. Bu turda bulunan ve kapatılan boşluklar

Planda olmayan, iş yapılırken **ortaya çıkan** kusurlar. Hepsi kapatıldı.

### 10.1 Şemada var, hiçbir formda yok: ilçe/mahalle
`properties.district_id`, `neighborhood_id`, `customer_demands.district_id`,
`customers.district_id` kolonları baştan beri duruyordu ama **hiçbir form
doldurmuyordu**. DB'de 81 il, **973 ilçe, 31.922 mahalle** kayıtlı ve hiçbiri
kullanılmıyordu. Sonuçları:

| Ne bozuktu | Nasıl |
|---|---|
| Emsal motoru | `find_comparables(p_district_id …)` hep NULL ilçeyle çağrılıyordu |
| Talep eşleştirme | `properties.ts` içinde `district_id: null` **sabiti** vardı |
| Değerleme | İlçe **serbest metindi**, `geo_districts` ile eşleşemiyordu |
| Fiyat sağlığı | `districtHint` değişkeni adına rağmen **il** adı taşıyordu |

Çözüm: `Combobox` (973 ilçe native `<select>`e sığmaz) + `GeoSelect` kademeli
seçici + 8 forma bağlantı. → **[x]**

### 10.2 Yazılıp hiç okunmayan iki tablo (ölü veri)
- `open_house_visitors`: `registerOpenHouseVisitor` yazıyordu, **hiçbir ekran
  okumuyordu**. Açık evin asıl çıktısı olan lead listesi görünmüyordu. → **[x]**
- `campaign_recipients`: her alıcı için durum ve **hata mesajı** tutuluyordu,
  liste yalnızca "12 hata" sayısını gösteriyordu. Kullanıcı hangi numaraya
  neden ulaşılmadığını öğrenemiyordu. → **[x]**

Sistematik tarama yapıldı: `property_status_history`, `contract_signers`,
`iys_consents`, `geo_*_stats` **okunuyor** — desen bu ikisiyle sınırlıymış.

### 10.3 Yanlış yere giden bağlantılar
- Anlaşma kanban kartı → **müşteri** sayfasına gidiyordu. Müşterisi olmayan
  anlaşma hiç tıklanamıyordu. → **[x]** anlaşma detayına
- Açık ev kartı → **portföye** gidiyordu, ziyaretçi listesine yol yoktu. → **[x]**

### 10.4 Arama hataları
- Portföy araması "konum ara" diyordu ama sunucu filtresi yalnızca kod+başlığa
  bakıyordu. İstemci tarafındaki il filtresi hiç devreye giremiyordu çünkü
  sunucu o satırları zaten elemişti. → **[x]**
- Seçici listeleri `.limit(100)` ile kırpılıyordu; 500 müşterili ofiste eski
  kayda ulaşmak imkânsızdı. Randevular sayfasında sorgu **hiç limitsizdi**.
  → **[x]** sunucu taraflı arama (`actions/lookup.ts`)
- `or()` dizgesine kullanıcı metni gömülüyordu; iki ayrı yerde iki ayrı ve
  **her biri eksik** temizleme vardı (`%` bırakılan yerde tüm kayıtlar
  çekilebiliyordu). → **[x]** `lib/pgrst.ts`

### 10.5 Değerlemenin çıktısı yoktu
Değerleme üretiliyordu ama müşteriye verilecek belge oluşturmak **mümkün
değildi**; projede tek bir `@media print` kuralı bile yoktu. → **[x]**
`/app/degerleme/[id]` + yazdırma katmanı. Rapor, hangi kaynağın ne ağırlıkla
girdiğini gösteriyor ve **SPK ekspertizi olmadığını** açıkça yazıyor.

### 10.6 `tasks` ve `property_media` normal kullanıcıya görünmüyordu
Bu iki tablonun RLS politikası kiracıyı `auth.jwt() ->> 'tenant_id'` ile
çözüyordu — yalnızca üst düzey claim. Ama uygulama tenant_id'yi üst düzeye
**hiç yazmıyor**, `app_metadata` içine yazıyor (`actions/auth.ts:140`,
`actions/team.ts:67`). Özel bir access-token hook'u da yok. İfade NULL'a
düşüyor, `tenant_id = NULL` asla TRUE olmuyor.

İkisi de kullanıcı istemcisiyle okunuyor — yani **Görevler modülü ve portföy
medyası RLS katmanında boş dönüyordu**.

Kök neden sürüklenme: `20260721000002_jwt_claims.sql` yardımcı fonksiyonu
düzeltmiş (app_metadata yedeği eklemiş), ama bir gün sonra yazılan
`property_media` ve `tasks` migration'ları yardımcıyı **çağırmak yerine**
ifadeyi satır içi kopyalamış — ve kopyaladıkları sürüm eskiydi. → **[x]**

Rollback'li canlı testle kanıtlandı: düzeltme öncesi 0 satır, sonrası 1 satır,
çapraz kiracı erişimi yok.

**Yan ürün: `scripts/rls-audit.ts`** (`npm run db:rls-audit`). Üç şey bakıyor:
RLS açık mı · politika `current_tenant_id()` kullanıyor mu (satır içi JWT
kopyası = bu hatanın kendisi) · **gerçek deneme**: `SET LOCAL ROLE
authenticated` + sahte JWT ile başka kiracı adına yazmaya çalışır. Rol
değişimi şart — RLS tablo sahibine uygulanmaz, superuser olarak koşan bir
test her şeyi "güvenli" görürdü. Her şey ROLLBACK ile biter.
Su anki sonuç: **39 tablo, bulgu yok.**

> Bir ara adımda "26 politikada `WITH CHECK` yok" diye şüphelendim. Denetimi
> yazıp **denedim**: hiçbiri sızdırmıyor — PostgreSQL ALL/UPDATE
> politikalarında `WITH CHECK` verilmemişse `USING`'i yazma denetimi olarak da
> kullanıyor. Rapor etmeden önce doğrulandı.

### 10.7 Sessiz liste kırpması — 25 sayfada
Panelde 25 liste sayfasında `.limit()` vardı ve **hiçbiri kullanıcıya bunu
söylemiyordu**: müşteriler 500, portföyler 200, talepler 200, teklifler 200,
anlaşmalar 200, görevler 100/200, komisyon 100, randevular 100, denetim 120…

600 müşterisi olan bir ofis 500 kayıt görüyor, kalan 100'den haberi olmuyordu.
Üstelik sayfa üstündeki "N sonuç" rozeti **çekilen kümeyi** sayıyordu, gerçek
toplamı değil — sayı doğru görünüyor ama yanlış şeyi sayıyor.

Sessiz kırpma en sinsi hata türü: ekranda hiçbir şey bozuk görünmez, kullanıcı
aradığı kaydı bulamaz ve "sistemde yok" sanır. Komisyon defterinde özellikle
kötü — para tutan bir listede eksik satır farkedilmez. Denetim kaydında ise
"kayıt yok" ile "kayıt var ama listede değil" farkı denetimin anlamını
belirliyor.

→ **[x]** `<ListLimitNotice shown total />` — 8 sayfaya bağlandı. Toplam,
sorguya `{ count: "exact" }` eklenerek **aynı yanıtta** geliyor; ek gidiş-dönüş
yok. Her şey ekrandaysa uyarı hiç render edilmiyor.

### 10.8 CI araç zinciri sürüklenmesi
Farklı npm sürümleri lockfile'ın opsiyonel platform girdilerini farklı ele
aldığı için yerel ve CI kurulumu ayrışmıştı. Doğrulanan çalışma ortamı Node
24.11.1 + npm 11.6.2'dir.
→ **[x]** `packageManager`, root engine, lockfile engine ve iki CI işi npm
11.6.2'ye sabitlendi; yerel ve CI aynı araç zincirini kullanıyor.

---

## 10.9 T3 hero şablonu — neden atlandı

58 sayfada hero bloğu kopya. İlk gerekçe "koyu temayı tek yerde çözmek"ti;
koyu tema geri alınınca o gerekçe de kalmadı. Kalan tek kazanç kod tekrarının
azalması — **kullanıcıya görünmeyen** bir iyileştirme karşılığında 58 sayfada
regresyon riski. Üstelik varyasyonlar gerçek: portföy sayfasının sağında fiyat
sağlığı grafiği var, diğerlerinde yok. **Üretim testinden hemen önce yapılması
yanlış olurdu.**

---

## 11. Bilinçli olarak YAPILMAYANLAR

Bunlar unutulmadı; yapılmama gerekçeleri var.

- **Dark mode (T4)** — token sistemi hazır ama 259 yerde `bg-white` doğrudan
  kullanılmış. Hepsini dönüştürmek yüksek regresyon riski taşıyor ve görsel
  doğrulama imkânı yok. Fayda riski karşılamıyor.
- **Hero şablonu (T3)** — 58 sayfada kopya ama varyasyonlar gerçek (portföy
  sayfasının sağında fiyat sağlığı grafiği var, diğerlerinde yok). Görünmeyen
  bir kazanç için görünür risk.
- **Kısa listelerde Combobox** — rol, şube, kategori, aciliyet gibi 2-30 öğeli
  listelerde native `<select>` KALIYOR: mobilde işletim sisteminin kendi
  seçicisi daha iyi ve JS yükü sıfır. Combobox yalnızca kayıt sayısıyla büyüyen
  listeler için (8 dosya).
- **PDF kütüphanesi** — Puppeteer (~300 MB) ya da jsPDF'e Türkçe font gömmek
  kazanılana göre çok pahalı. Tarayıcının kendi "PDF olarak kaydet" akışı doğru
  fontu, doğru sayfa kırılmasını ve seçilebilir metni zaten veriyor.
- **Bundle optimizasyonu (P1)** — ölçüldü: `recharts` yalnızca 4 sayfada,
  paylaşılan kabukta değil. Kanıtlanabilir bir kazanç görünmediği için
  spekülatif iş yapılmadı.

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
