# İlan Kontrol: Eklenti + Günlük Eşleştirme Tasarımı (2026-10)

Durum: TASARIM (kod değişmedi). Amaç: "eklentiyi kur, hesabını bağla, gerisi otomatik."
Kapsam notu: bu belge mevcut sistemi SIFIRDAN yazmaz; boşlukları kapatır.

## 1. Mevcut durum (kodda doğrulandı)

- Eklenti v0.2.0 (`extensions/emlaksoft-ilan-kontrol`): MV3 service worker (`background.ts`), `permissions: storage, alarms`,
  `host_permissions` yalnız sahibinden/hepsiemlak/emlakjet (`scripts/build-extension.ts`). Sekmesiz `fetch(credentials:"include")`,
  hız/kira kuralı (`extension-pacing.ts`), outbox, ayrıştırıcılar (`adapters/html/*`), `lc_parser_telemetry`.
- Bağlama: "Bağlan" tıklanana dek hiçbir portal isteği yok; EmlakSoft sekmesindeki açık oturumla konuşur (saklı token yok).
  `externally_connectable` KULLANILMIYOR; kanal içerik betiği + `window.postMessage` köprüsü.
- Kurulum: zip indir → "paketlenmemiş yükle" (3 adımlı sihirbaz `extension-wizard.ts`). Mağaza adresi env ile (henüz yok).
  HAFIZA: "gerçek portalda DOĞRULANMADI".
- Sunucu: `portal_listings`, `listing_verifications`, `listing_anomalies`, `listing_matching_candidates`, `listing_inventory_imports`,
  `portal_match_feedback`; eşleştirme `matching.ts` (ilan no/URL kesin, adres, konum, fiyat, m², oda, başlık; foto sağlayıcı arayüzü BOŞ);
  envanter karşılaştırma `inventory-import.ts` + `bulk-mismatch.ts`; cron adımları `server/cron-steps.ts` (`portal-teyit`, 6 saatte bir).

Sonuç: motor büyük ölçüde VAR. Eksikler: (a) tek tık kurulum (mağaza), (b) ofisin KENDİ mağaza ilanlarını eklentinin kendiliğinden toplaması,
(c) bunun günlük zamanlanması + sunucu tarafı günlük eşleştirme/fark özeti, (d) foto karması, (e) sade ekranlar.

## 2. Gerçekçi kısıtlar (neyin MÜMKÜN OLMADIĞI)

1. **Siteden "tek tıkla otomatik kurulum" yok.** `chrome.webstore.install()` (inline install) 2018'de kaldırıldı, Chrome 71'de çağrı hata verir;
   site yalnız kullanıcıyı Web Store sayfasına yönlendirebilir, "Ekle" onayını KULLANICI verir. Edge için ayrı Add-ons mağazası (aynı paket
   çoğunlukla çalışır, ayrı yükleme). Mümkün olan en yakını: büyük "Eklentiyi ekle" düğmesi → mağaza sayfası → dönüşte otomatik algılama.
2. **Sessiz/zorunlu kurulum yalnız kurumsal politikayla:** `ExtensionInstallForcelist` (Google Admin > Chrome > Uygulamalar ve uzantılar > "Force install";
   Edge/Windows GPO veya Intune). Bu bir BT yöneticisi işidir; tek-iki kişilik emlak ofisi için gerçekçi değil. Sadece çok şubeli/kurumsal
   ofis için "Yönetici kurulum rehberi" (eklenti kimliği + güncelleme URL'si kopyala) olarak sunulur.
3. **Eklenti her zaman çalışmaz.** MV3 service worker boşta ~30 sn sonra kapanır; `chrome.alarms` alt sınırı 1 dk ve yalnız TARAYICI AÇIKKEN
   tetiklenir (bilgisayar uykudaysa/Chrome kapalıysa atlanır, açılışta kaçırılan alarm bir kez çalışır). "Her gün 03:00 garanti" VAAT EDİLMEZ;
   vaat: "tarayıcı açıldıktan sonra günde en az bir kez, kaçırılırsa ilk açılışta."
4. **Sunucudan kazıma yok/yapılmayacak:** portallar Cloudflare/bot koruması kullanır (CAPTCHA, IP/UA kontrolü); EmlakSoft sunucusundan
   `fetch` ile okuma hem engellenir hem sözleşme riskidir. Yalnız kullanıcının KENDİ tarayıcısı, KENDİ oturumu, KENDİ ilanları (mevcut ilke).
5. **Offscreen document gerekmez:** service worker host_permissions ile cross-origin `fetch` yapabilir (çerezler `credentials:"include"` ile gider;
   SameSite/Cloudflare çerezi tarayıcı bağlamında geçerli). Offscreen (DOM ayrıştırma için) yalnız ayrıştırıcı DOMParser isterse; mevcut
   saf ayrıştırıcı string üzerinde çalıştığından gereksiz. İstek sırayla, düşük hızda; engel (403/CAPTCHA) görülünce 30 dk durulur (mevcut).
6. **Resmi API belirsiz:** sahibinden EİDS entegre firmalar listesinde (yetki doğrulama), ama kamuya açık bir "ilan okuma API'si" bulunamadı.
   Rekabet Kurulu (2023, RE-OS şikâyeti, 40 mn TL ceza): sahibinden kurumsal üyelere ilan verisini başka platformlara taşıma altyapısı
   SAĞLAMAK zorunda. Yani ileride resmi dışa aktarma/XML yolu çıkabilir; bunu İZLE, ama bugün varsaymak yok. CSV/yapıştırma yedek yol kalır.
7. **Portal HTML'i değişir:** ayrıştırıcılar kırılır; bu yüzden `lc_parser_telemetry` + "kontrol edilemedi" dürüst durumu şart (var). Gerçek
   portalda doğrulanmadan "otomatik" pazarlanmaz.
8. **Mobil tarayıcı:** Chrome Android eklenti çalıştırmaz → mobilde yalnız sonuç görüntüleme; toplama masaüstünden.

## 3. Önerilen mimari

```
[Ofis PC: Chrome/Edge açık]                         [EmlakSoft sunucu]
 eklenti SW ──alarm (1 saatte bir uyan,            /api/app/ilan-kontrol/envanter (POST, oturumlu)
   günde ≥1 tam tur)                                   │
   1) Mağazam/ilanlarım sayfalarını sırayla oku ──────►  listing_inventory_imports (tam liste bayrağı)
      (kullanıcının oturumu, düşük hız)                │
   2) ilan detay doğrulama (mevcut kuyruk) ───────────►  listing_verifications
                                                       ▼
                                      cron `portal-teyit` (MEVCUT) yeni adım: gunlukEslestir
                                        compareInventory + rankCandidates + foto karması
                                        → listing_anomalies / listing_matching_candidates / insights
```

- **Yeni cron YOK:** 36 sözleşmesi korunur. `portal-teyit` içindeki gece penceresinde (`isDailyDuplicateWindow`, UTC 00–06) yeni adım
  `runControlStepDailyMatch` çalışır; ayrıca envanter yükleme geldiğinde olay (`listing_control_events`) ile ilgili kiracı hemen işlenir
  (kullanıcı "şimdi eşleştirdi" hissi alır).
- **Eşleştirme iki aşamalı:** (1) sert: ilan no/URL birebir → otomatik bağla; (2) yumuşak: skor ≥ 85 "Önerilen eşleşme" (tek tık onay),
  60–84 "Emin değilim", < 60 aday gösterilmez. Onay/ret `portal_match_feedback`'e yazılır ve sonraki turda öğrenilmiş sabit eşleşme olur.
- **Mağaza listesi toplama:** yeni "mağaza envanteri" okuyucu görevi (sahibinden "ilanlarım" sayfalama, hepsiemlak/emlakjet panel listesi);
  ayrıştırıcı `ObservedListing[]` döner (id, url, başlık, fiyat, m², oda, konum metni, ilk foto URL, durum, danışman). Liste TAM sayılması
  için sayfalama bitişi doğrulanmalı (toplam ilan sayısı rozeti = okunan sayı), aksi halde "listede yok" üretilmez (mevcut dürüstlük kuralı).
- **Kurulum algılama:** mevcut belge-kökü işareti yeterli. Mağaza yayınından sonra OPSİYONEL `externally_connectable` (yalnız EmlakSoft kökenleri)
  ile `sendMessage(EXT_ID,{ping})` — içerik betiği zaten çalışıyorsa gerekmez; mevcut kararı (köprü) KORU, ek yüzey açma.
- **Otomatik bağlama:** kurulum sonrası kullanıcı EmlakSoft'a döner, sayfa eklentiyi algılar ve "Bağlan" düğmesi tek tık (mevcut). Bağlantı
  süresi 30 gün sessiz yenilenir (EmlakSoft açıldıkça) — "ayda bir tekrar bağla" hissi olmasın.

## 4. Basit kullanıcı akışı (3 adım)

1. **Kur:** `/app/ilan-kontrol` ilk açılışta tek büyük kart "Eklentiyi ekle" → Web Store/Edge Add-ons (zip yalnız geliştirici modunda gizli bağlantı).
2. **Bağla:** dönünce kart otomatik "Eklenti bulundu → Hesabımı bağla" (tek düğme). Portal girişi eklentide İSTENMEZ; kullanıcı portala zaten
   kendi sekmesinde girişli ise çalışır, değilse "sahibinden'e giriş yapın" rozeti (giriş bilgisi hiç alınmaz).
3. **Otomatik:** "Tamam. Her gün kontrol edeceğim." Kullanıcıdan başka eylem beklenmez; sonuç sabah özeti ve Bugün ekranında.
   Sorun varsa tek cümle + tek düğme (örn. "sahibinden oturumu kapalı → Aç").
- Ayarlar kısa: portal aç/kapa, çalışma saatleri (mevcut). Gelişmiş hız ayarı gösterilmez.

## 5. Ekranlar (yeni sayfa YOK; menü ilkesi: mevcut `ilan-kontrol` sekmeleri)

- **Özet (page.tsx):** üstte durum şeridi (Eklenti: bağlı · son tam okuma: dün 14:20 · sonraki: tarayıcı açılınca). Dört tıklanabilir kart:
  Eşleşen N · Onay bekleyen N · Yayında olmayan portföy N · Portföyde olmayan ilan N (hepsi filtreli listeye gider).
- **Eşleşme sekmesi (`eslesme`):** iki sütunlu kart: sol portföy (foto, adres, fiyat), sağ portal ilanı (foto, başlık, fiyat), skor + "neden"
  rozetleri (ilan no ✓, konum ✓, fiyat ±%3). Düğmeler: "Evet, aynı" / "Hayır" / "Sonra". Toplu "Eminleri onayla".
- **Farklar (`anomaliler`):** fiyat değişti (portföy 4,2 mn · ilan 4,4 mn), ilan kalktı, portföyde yok, süresi doldu, danışman farklı.
  Her satırda tek eylem: "Portföyü düzelt" / "Portala git" / "Yok say".
- **Eklenti (`eklenti`):** yukarıdaki 3 adım sihirbazı + sağlık (son okuma, parser sürümü, engel varsa neden) + yönetici kurulum rehberi (katlanır).
- Rapor/indirme düğmesi KOYMA; "Raporlarda aç" bağlantısı (Rapor merkezi kuralı).

## 6. Veri modeli değişiklikleri (yeni migration; forward-only; canlıya uygulama onay+yedek sonrası)

- `portal_listings`: `thumb_hash` (text, 64-bit dHash hex), `last_seen_at`, `seen_in_full_scan_id` (uuid). (Kolon yoksa ekle.)
- `properties` yan tablo `property_photo_hashes(tenant_id, property_id, photo_id, dhash text)` — RLS `current_tenant_id()`; yükleme anında hesaplanır
  (sunucu, sharp 9x8 gri). Portal ilanı tarafı: eklenti ilk foto URL'sini okur; hash'i SUNUCU hesaplar (portal CDN görseli, kullanıcı oturumsuz,
  tek istek/ilan; bot koruması çıkarsa foto sinyali "ölçülemedi" sayılır, paydadan çıkar — mevcut kural).
- `listing_inventory_imports`: `source` ('extension'|'csv'|'paste'), `complete boolean`, `expected_count`, `read_count` (tam liste kanıtı).
- `listing_match_links(tenant_id, property_id, portal, external_id, status['confirmed','suggested','rejected'], score, signals jsonb, confirmed_by, confirmed_at)`
  unique (tenant_id, portal, external_id); `portal_match_feedback`'in yerine geçmez, onu besler. (Önce mevcut `listing_matching_candidates` ile
  birleştirilebilir mi kontrol et; mükerrer tablo açma.)
- `listing_inventory_diffs` ya da mevcut `listing_anomalies`'a tür ekle: `price_changed`, `listing_gone`, `portfolio_unpublished`, `portal_orphan`.
  Enum ADD VALUE kullanımı ayrı dosya (087/087b deseni).
- Günlük özet: tüketici `insights` (kanıtlı, `href` zorunlu); örnek/demo veri içgörü üretmez.

## 7. Eşleştirme algoritması (mevcut `matching.ts` üstüne)

Ağırlıklar (ölçülemeyen sinyal paydadan çıkar): ilan no/URL birebir → 100 (karar verici); konum ≤30 m 20; adres/mahalle 15; m² ±3% 15;
oda tam 10; fiyat ±%5 15; foto dHash Hamming ≤10/64 15 (en az 1 foto çifti); başlık benzerliği 5; danışman adı 5.
Çakışma çözümü: aynı portal ilanı birden çok portföye ≥85 verirse otomatik bağlama YAPILMAZ, "hangisi?" sorulur. Fiyat farkı ≥%2 ve eşleşme
onaylıysa "fiyat değişti" uyarısı; onaylı eşleşme son TAM taramada yoksa 2 ardışık tam taramada görülmeyince "ilan kalktı" (tek eksik okumayla alarm yok).
Güven skoru kullanıcıya yüzde + "neden" rozetleri olarak gösterilir; sahte skor yok.

## 8. Risk / uyumluluk (yalnız bilgi, engel değil)

- Sahibinden kullanım koşullarında otomatik erişim kısıtları olabilir; yaklaşım kullanıcının kendi oturumundan kendi ilanlarını düşük hızla okumaktır
  (tarayıcı otomasyonu). Hesap uyarısı/engel riski kullanıcıya açıkça söylenir ("tek sorumlusu siz değilsiniz ama engel görürsek durur").
- KVKK: ilan sahibi/danışman adı dışında kişisel veri toplanmaz; AI'ya giden metin `redact.ts` üzerinden.
- Chrome Web Store: tek amaçlı açıklama, gizlilik politikası, minimum izin (yalnız 3 portal host'u) gerekir; geniş `<all_urls>` istenmez. İnceleme günler sürebilir;
  Edge ayrı gönderim. Mağaza hesabı ve gönderim SAHİBİN işidir.
- Portal HTML değişince kırılma beklenir: telemetri + sürüm bildirimi + sunucudan ayrıştırıcı kural JSON'u (`portal-rules.json`) uzaktan güncelleme
  (yalnız kural verisi, çalıştırılabilir kod DEĞİL; MV3 uzak kod yasağı).

## 9. Uygulama iş listesi (öncelik sırasıyla)

1. **Gerçek portal doğrulaması** (engelleyici): sahibinden/hepsiemlak/emlakjet "ilanlarım" fixture'ları gerçek hesapla toplanır →
   `adapters/html/test-fixtures.ts`, `parser-fixtures.test.ts`. Doğrulanmadan 2–8 yayımlanmaz.
2. `adapters/html/{sahibinden,hepsiemlak,emlakjet}-html.ts` + `adapters/types.ts`: `parseStoreList(html)` → `ObservedListing[]` + sayfa sayısı/toplam.
3. `extensions/.../src/background.ts` + `worker/extension-pacing.ts`: günlük tam tur planı (alarm 60 dk; son tam tur >20 sa ise başla, kaçırılanı telafi),
   mağaza listesi sayfalama görevi, yükleme `/api/app/ilan-kontrol/envanter`. `messages.ts` yeni ileti türleri.
4. Migration dosyası (`migration-yazici` ajanı): bkz. §6. `src/lib/listing-control/types.ts` güncelle.
5. `server/cron-steps.ts`: `runControlStepDailyMatch` (portal-teyit gece penceresi) + `server/sync.ts` envanter-olayı tetikleyici; `inventory-import.ts`
   `complete`/2-tarama kuralı; `check:cron` sayısı değişmez (36).
6. `matching.ts`: `SimilarityProvider.photoSimilarity` dHash uygulaması (`src/lib/listing-control/photo-hash.ts`, sunucu-only), çakışma çözümü, testler
   (`matching-sla-closure.test.ts` yanı).
7. UI: `app/ilan-kontrol/page.tsx` (durum şeridi + 4 kart), `eslesme/page.tsx` (onay kartları, toplu onay), `anomaliler` (fark türleri),
   `eklenti/page.tsx` + `worker/extension-wizard.ts` + `extension-copy.ts` (3 adımlı sade metin; mağaza düğmesi `NEXT_PUBLIC_EXTENSION_STORE_URL`).
8. Kurumsal: `eklenti` sayfasında "Yönetici kurulum rehberi" (Google Admin force-install + Edge GPO/Intune adımları, eklenti kimliği).
9. Sözleşme testleri: yeni cron yok, `requirePermission('ilan_kontrol', ...)` kapıları, admin-client allowlist değişimi gerekiyorsa `audit-admin-client.ts --write`.
10. (Sahip işi) Web Store + Edge Add-ons hesabı, gizlilik politikası, gönderim; sahibinden resmi dışa aktarma/XML (Rekabet kararı) takibi.

## Kaynaklar
Chrome inline installation deprecation FAQ (developer.chrome.com/docs/extensions/mv2/inline-faq); chrome.alarms (developer.chrome.com/docs/extensions/reference/alarms);
externally_connectable (developer.chrome.com/docs/extensions/reference/manifest/externally-connectable); Cross-origin requests (developer.chrome.com/docs/extensions/mv3/xhr);
Offscreen API; force-install rehberleri (Google Admin, Edge GPO, Intune); Rekabet Kurulu sahibinden kararı (paradergi.com.tr, 2023-08-24); EİDS entegre firma listesi (alomaliye.com).
