# Gelişmiş SEO sistemi: boşluk haritası ve yapılanlar (2026-10)

Sahip isteği: "en gelişmiş, en otomatik, en yeni teknoloji SEO sistemi; arama motorlarında bir numaraya çıkarmak için
otomatik uygulamalar, tavsiyeler; optimizasyon puanı versin."

Bu belge önce mevcut sistemi en iyi platformlarla (Semrush/Ahrefs Site Audit, Yoast/RankMath puanlaması, Google Search
Console, PageSpeed/CrUX, Surfer içerik puanı, programatik SEO, GEO/AI arama) karşılaştırır, sonra bu turda kurulanları
ve kurulmayanların gerekçesini yazar. İlke değişmedi: **yalnız beyaz şapka**, sahte skor yok, veri yoksa sayı yok,
tahmin "tahmini" etiketlidir, yapay zekâ varsayılan KAPALI.

## 1. Boşluk haritası

Durum: **VAR** (tam), **KISMİ** (eksik parçası var), **YOK** (bu turdan önce hiç yoktu).

| Alan | Rakip karşılığı | Bu turdan önce | Bu turda |
| --- | --- | --- | --- |
| Site taraması (durum kodu, başlık, açıklama, canonical, h1, OG, robots, JSON-LD, yinelenen, yetim, kırık iç bağlantı, keşif 2 seviye) | Ahrefs/Semrush Site Audit | VAR (`audit-rules.ts`, `audit-runner.ts`, günlük `seo-robot`) | Sayfa başına ölçüm anlık görüntüsü eklendi (`seo.audit.pages`) |
| Kırık görsel denetimi | Site Audit "broken images" | YOK | VAR: kendi kökenimizdeki `<img>` örneklemesi (HEAD) |
| İç bağlantıda yönlendirme / yönlendirme zinciri (canlı HTTP) | Site Audit "redirect chains" | KISMİ (yalnız kural listesinde döngü/zincir) | VAR: iç bağlantı 3xx ise uyarı, ≥2 atlama zincir bulgusu |
| Optimizasyon puanı 0–100 (sayfa + site + kategori) | Semrush "Site Health", Yoast/RankMath puanı | KISMİ (Kokpit "Site notu" bulgu cezası; kategori ve sayfa puanı yok) | VAR: 5 kategorili sayfa puanı, ağırlıklı site puanı, vitrin (ofis) puanı |
| Puan geçmişi, trend, "neden düştü" | Semrush trend | KISMİ (yalnız bulgu sayısı geçmişi) | VAR: `seo.audit.scores` (90 nokta), sparkline, düşüş nedenleri |
| Türkçe piksel genişliğiyle başlık/açıklama | Yoast/RankMath SERP önizleme (px) | YOK (karakter sınırı) | VAR: `pixel-width.ts` (Arial genişlik tablosu, Türkçe harfler dahil) |
| Yapılandırılmış veri doğrulama | Rich Results Test | KISMİ (zorunlu alan + yasak puan/yorum) | VAR: önerilen alan uyarıları (RealEstateListing/Offer/Place, RealEstateAgent/LocalBusiness, CollectionPage/ItemList, SearchAction) |
| Otomatik düzeltme kuyruğu, önce/sonra, tek tık, Otopilot (kategori bazlı otomatik uygula), denetim izi, geri alma | RankMath/Yoast otomasyonları, Semrush "fix" | VAR (Kokpit `site_issues`, `site_optimizer_actions`, `growth.autopilot`, SEO geçmişi) — yalnız 2 meta kuralı | Kural eklendi: uzun başlık (piksel), eksik açıklama, sitemap tazeleme; Otopilot izin listesi genişledi |
| AI ile başlık/açıklama önerisi | Surfer/RankMath AI | VAR (`ai-suggest.ts`, openai-client + redact, varsayılan KAPALI, kota) | Değişmedi |
| İlan fotoğrafı alt metni | — | VAR (`vitrin-seo/alt-text.ts`, metadata'dan) | Değişmedi |
| JSON-LD otomatik basımı | RankMath schema | VAR (registry türleri, vitrin ilan/ofis, danışman, rehber) | Programatik sayfalar için CollectionPage + ItemList + FAQPage + BreadcrumbList |
| Search Console verisi (sorgu, sayfa, tıklama, gösterim, pozisyon; günlük) | GSC | VAR (`google-senkron` cron, `seo_gsc_daily`, Performans sekmesi, CTR fırsatı) | — |
| Kazanan/kaybeden sorgular, pozisyon 4–20 fırsatı, yamyamlık (cannibalization) | Ahrefs/Semrush Position Tracking | YOK | VAR: `keywords.ts` + `seo_gsc_keyword_pairs` RPC (migration 20261024030000) |
| Tavsiye motoru (etki × kolaylık, sayfa başına Türkçe öneri) | Semrush "SEO Ideas", Ahrefs "Opportunities" | KISMİ ("şunu düzeltirseniz +N") | VAR: `recommend.ts`, her öneri düzeltme ekranına bağlı, tahmin etiketli |
| Hız (CrUX/PSI, laboratuvar, saha) | PageSpeed/CrUX | VAR (`/admin/site/hiz`, `perf_lab_runs`, RUM) | Puanın "performans" kategorisi bu veriden; yoksa sayfa ağırlığından tahmin |
| Programatik bölge sayfaları ("Kadıköy satılık daire") | Zillow/Hepsiemlak hub sayfaları | YOK | VAR: `/emlak/...` (yalnız gerçek ilan, ≥N eşiği altında noindex) |
| İçerik puanı (okunabilirlik, başlık yapısı, anahtar kelime, iç bağlantı) | Surfer/Yoast içerik analizi | KISMİ (rehberde ince içerik / H2 yok uyarısı) | VAR: Ateşman okunabilirliği + odak kelime, canlı panel (tembel ada) |
| llms.txt | GEO | VAR (varsayılan KAPALI, admin açar) | llms-full.txt eklendi (aynı anahtarla açılır) |
| Yapay zekâ tarayıcı izinleri (GPTBot, Google-Extended, PerplexityBot, ClaudeBot…) | GEO | VAR (`blockedAiBots`, robots.txt) | GEO sekmesinde hazırlık puanı ile birlikte |
| Kuruluş varlık tutarlılığı (Organization sameAs, logo, iletişim) | GEO / Knowledge Graph | KISMİ (alanlar var, denetim yok) | VAR: GEO hazırlık kontrol listesi |
| IndexNow + yayında bildirim | Bing/Yandex | VAR (varsayılan KAPALI; yayın sonrası kanca, günlük) | Değişmedi |
| Sitemap ping (Google) | — | Bilerek YOK (Google 2023'te ping ucunu kapattı; IndexNow + Search Console sitemap kaydı yeterli) | Değişmedi |
| hreflang | Site Audit | Uygulanamaz (tek dil tr-TR) | Puanda "uygulanamaz" |
| WebSite + SearchAction | Sitelinks search box | Bilerek YOK (çalışan site içi arama yok; Google 2024'te kutuyu kaldırdı) | Doğrulayıcı varsa hedefi denetler |
| Rakip / harici site taraması, backlink | Ahrefs | Bilerek YOK (yalnız kendi alan adımız; harici tarama ve skrap yok) | Değişmedi |

## 2. Puan modeli (SEO Optimizasyon Puanı)

Kaynak: robotun son koşusundaki sayfa anlık görüntüleri (`seo.audit.pages`) + hız ölçümleri (`perf_lab_runs`, yoksa
sayfa ağırlığı tahmini) + Search Console sorgusu (varsa). Robot hiç çalışmadıysa puan YOKTUR ("veri yok").

Sayfa puanı = kategori puanlarının ağırlıklı ortalaması (uygulanamayan kategori ağırlığı dağıtılır):

| Kategori | Ağırlık | İçerik |
| --- | --- | --- |
| Teknik | 30 | HTTP 2xx, indekslenebilirlik ↔ sitemap tutarlılığı, canonical (mutlak, kendine), robots engeli yok, yönlendirme yok, yinelenen başlık/açıklama yok, karışık içerik yok |
| Sayfa içi | 30 | Başlık piksel genişliği (≤580 px; 200–580 ideal), açıklama (430–920 px), tek h1, başlık sırası, anahtar kelime (GSC en çok gösterim alan sorgu ya da h1 konusu) başlık/URL/h1'de, iç bağlantı giriş/çıkış, görsel alt metni oranı, ince içerik |
| Yapılandırılmış veri | 15 | Ayrıştırma hatası yok, zorunlu alan hatası yok, sayfa türüne uygun tür var (ilan: RealEstateListing; vitrin: RealEstateAgent; iç sayfa: BreadcrumbList), önerilen alanlar |
| Performans | 15 | PSI/CrUX puanı varsa o (mobil); yoksa TTFB + HTML boyutundan **tahmini** puan (etiketli) |
| Tazelik | 10 | Sitemap lastmod yaşı (≤90 gün tam puan, 365+ gün en düşük); lastmod yoksa uygulanamaz |

Site puanı = sayfa puanlarının ortalaması (ana sayfa ×3, sitemap'teki indekslenebilir sayfalar ×1, keşifle bulunan
noindex sayfalar ×0,25) − site geneli kritik bulgu cezası (sitemap/robots okunamıyor: −10). Vitrin (ofis) puanı:
arama onayı, vitrin açık, yayındaki ilan sayısı, fotoğraflı ilan oranı, açıklamalı ilan oranı, ofis iletişim/adres/logo,
taranan vitrin sayfalarının ortalama puanı.

"Neden düştü": iki koşu arasında puanı en çok düşen sayfalar ve o sayfada yeni başarısız olan kontroller.

## 3. Otomatik düzeltmeler (beyaz şapka)

Mevcut Kokpit kuyruğu kullanılır (yeni kuyruk yok): bulgu → öneri (önce/sonra) → "Taslağa al" (tek tık) ya da
Otopilot (kategori izin listesi; varsayılan KAPALI; yalnız "güvenli" risk). Taslak canlıyı değiştirmez; yayın Yayın
masasından; her işlem `site_optimizer_actions`'a yazılır; SEO ayarları geçmişten tek tıkla geri alınır.

Yeni kurallar: uzun başlık (piksel sınırında sözcükle kısaltma, marka eki korunur), eksik açıklama (registry varsayılanı
ya da sayfa etiketinden şablon), sitemap tazeleme (önbellek etiketi). Anahtar kelime doldurma, gizleme (cloaking),
sahte puan/yorum, otomatik noindex ASLA yapılmaz; ince programatik sayfa eşik altında kendiliğinden noindex'tir.

## 4. Programatik bölge sayfaları

Yol: `/emlak/{il}`, `/emlak/{il}/{ilce}`, `/emlak/{il}/{ilce}/{niyet}`, `/emlak/{il}/{ilce}/{mahalle}/{niyet}`;
niyet `satilik-daire`, `kiralik-2-1-daire`, `satilik-villa` biçimindedir. Kaynak: arama onayı veren, vitrini açık,
kalıcı noindex listesinde olmayan ofislerin yayındaki, kapanmamış, örnek olmayan ilanları. Kurallar:

- İlan sayısı ≥ eşik (varsayılan 5) → index; 1..eşik-1 → `noindex, follow`, sitemap dışı; 0 → 404.
- Giriş metni yalnız gerçek istatistikten: ilan sayısı, medyan fiyat (tam ₺, yalnız TL ilanlar), medyan m² fiyatı.
- SSS gerçek veriden (sayfada görünen SSS = FAQPage), BreadcrumbList, alt bölgelere ve üst bölgeye iç bağlantı.
- Özellik varsayılan KAPALI: süper admin "Programatik sayfalar" sekmesinden açar; eşik, düzeyler ve tek tek kapatılan
  sayfalar oradan yönetilir. Sayfalar sunucu bileşenidir (istemci JS yok).

## 5. Bilerek yapılmayanlar

- Harici/rakip site taraması, backlink verisi, arama hacmi API'si: yok (sahte hacim uydurulmaz; "hacim" yalnız GSC gösterimidir).
- Google sitemap ping: uç kapandı. Bing/Yandex için IndexNow var.
- Otomatik noindex/canonical değişikliği: risklidir, öneri olarak gösterilir, elle uygulanır.

## 6. Sahibin yapması gerekenler

- Search Console bağlantısı (`/admin/site/baglantilar`): anahtar kelime sekmesi bağlantı yokken kurulum kartı gösterir.
- PageSpeed API anahtarı (`/admin/site/hiz`): yoksa performans puanı tahmini kalır.
- Programatik sayfaları açma kararı (ofis ilanları çok ofisli bir sayfada listelenir; yalnız arama onayı verenler).
- Migration `20261025020000_seo_gsc_keyword_pairs` (ek; yokken anahtar kelime analizi "kurulum bekliyor" der).
- llms.txt / llms-full.txt açma, yapay zekâ tarayıcı izinleri (GEO sekmesi).
