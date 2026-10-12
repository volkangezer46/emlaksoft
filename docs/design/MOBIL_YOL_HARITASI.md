# EmlakSoft Mobil: Yol Haritası (Android önce, iOS sonra)

Durum: TASARIM / PLAN (2026-10-08). Kod yok. Ekran taslakları: claude.ai Design sayfası "EmlakSoft Mobil Ekranlar" (Bugün, Müşteri kartı, Ofis sahibi, Kilit ekranı, Sabah brifingi, Widget, Sesli not).

## 1. Kapsam

- **Mobilde:** danışman, ekip lideri, ofis sahibi/GM/şube müdürü (onay ve özet), çağrı merkezi, muhasebe (gider/aidat), salt okunur rol. Ekran seti `src/lib/nav-roles.ts` çekirdek menülerinden türetilir.
- **Mobilde yok (web'de kalır):** /admin, Ayarlar, Roller, Otomasyon, Uyum, Denetim, SEO, Projeler, Kampanyalar, Sözleşme şablonları, Abonelik/ödeme (mobilde yalnız "web'den yönetin" yönlendirmesi).
- Alt çubuk: Bugün, Müşteriler, Portföy, Anlaşmalar, Daha fazla (`MOBILE_TAB_SECTIONS`) + altın "Hızlı kayıt" (`/app/hizli` mantığı).

## 2. Teknoloji

Expo (React Native) + TypeScript + Expo Router, development build (Expo Go değil). Tek kod tabanı, iOS'a geçişte ekranların ~%90-95'i ortak. EAS Build ile Windows'tan iOS derlenir. NativeWind + `tokens.css` türevi token katmanı, Reanimated, FlashList, bottom-sheet, expo-image, TanStack Query + MMKV (çevrimdışı önbellek ve yazma kuyruğu), expo-secure-store, expo-local-authentication, expo-notifications (FCM/APNs), Sentry. Paylaşılan paket: `phone-rules`, zod şemaları, etiketler, izin matrisi.

## 3. Mimari kural (kritik)

Danışman kapsamı (yalnız kendi kayıtları) uygulama katmanında uygulanıyor (HAFIZA §6: kapsam RLS'e taşıma ertelenmiş). Bu yüzden mobil Supabase'e doğrudan bağlanmaz; **tüm veri `/api/mobile/v1/*` üzerinden, her uçta `requirePermission` + kapsam ile** akar. Mevcut `/api/v1` API-anahtarı/webhook içindir, mobil için kullanılmaz. Push için `device_tokens` tablosu (RLS'li, migration) ve FCM/APNs kanalı; bildirim üretimi (`notify.ts`) aynı kalır, yeni kanal eklenir. API versiyonlama + "zorunlu güncelle" mekanizması.

## 4. Fazlar

| Faz | İçerik | Süre* |
|---|---|---|
| **A0 Karar ve hesaplar** | Sahip kararları (bkz. §7), Google Play + Apple hesapları (Apple kurum doğrulaması günler sürer) | 1 hf |
| **A1 Mobil API** | `/api/mobile/v1` oturum, yetki, kapsam, `device_tokens`, sürüm uyumu | 2 hf |
| **A2 Tasarım sistemi** (A1 ile paralel) | Token'lar, 15-20 temel bileşen, tema (açık/koyu/sistem), ikon seti | 2 hf |
| **A3 Danışman çekirdeği** | Giriş + biyometri, Bugün, Müşteri/Talep/Portföy liste ve detay (sunucu filtre, gerçek sayfalama), Randevu, Görev, Hızlı kayıt, Bildirim merkezi, **rehberden seçerek içe aktarma** | 4-5 hf |
| **A4 Native değer** | FCM push, kamera/galeri ile ilan fotoğrafı, tıkla-ara + görüşme sonrası not, WhatsApp kısayolu, takvime ekleme, derin bağlantı, çevrimdışı kuyruk, **sabah brifingi + widget**, **sesli not → onaylı kayıt**, **"Rehbere kaydet"**, Android arama filtreleme (müşteri kartı açma), arama kaydı eşitleme (bkz. §5) | 3-4 hf |
| **A5 Rol genişlemesi** | Gelen Kutusu (kanal rozetleri), Anlaşmalar, Komisyon/Kazanç, Performansım, Değerleme, ofis sahibi ekranları (Onaylar, Ekip karnesi, İlan Kontrol uyarıları), çağrı merkezi ve muhasebe sadeleştirmesi | 3 hf |
| **A6 Kalite ve Play yayını** | Çökme izleme, düşük donanımlı Android performansı, erişilebilirlik, kapalı test, mağaza varlıkları, kademeli yayın | 2-3 hf |
| **I1-I3 iOS** | Aynı kod; APNs, Face ID, iOS davranış farkları, Call Directory yerine rehbere kayıt, TestFlight, App Store incelemesi | 3-4 hf |
| **K Kanallar** (ayrı faz) | WhatsApp tam (iş parçacığı + 24 sa pencere içi cevap), sonra Instagram DM ve Facebook Messenger (Meta Graph API, mevcut `/api/webhooks/meta`); sahip işi: Meta Business hesabı, uygulama incelemesi | 4-6 hf |
| **S Santral** (isteğe bağlı) | Bulut santral: tıkla-ara (geri arama), sunucu tarafı çağrı kaydı, arama kaydı eşitlemenin iki platform için garantili yolu | 2-3 hf |

*Deneyimli tek geliştirici için; Android pilotu (A0-A6) ~14-17 hf, iOS +3-4 hf.

## 5. Arama ve iletişim akışı (platform gerçekleri)

- **Telefonla arama:** Müşteri kartından "Ara" sistem arama ekranını açar (iki platform). Dönüşte uygulama "Görüşme nasıldı?" diye sorar (sesli not / sonuç / sonraki adım). MVP bu.
- **Gelen arama, müşteri ekranı:** Android'de "arama filtreleme" rolüyle numara alınır ve müşteri kartı tam ekran bildirim/üst katmanla açılır (yerel Kotlin modülü, Play beyanı gerekir). iOS'ta uygulama gelen aramayı göremez ve kendiliğinden açılamaz; alternatif: müşteriyi rehbere "ES · Ad Soyad" kaydetmek (arayan adı görünür).
- **Arama kaydı (ses):** Normal telefon aramasının sesi iki platformda da alınamaz. Seçenekler: sesli not, yüz yüze görüşme kaydı, bulut santral (sunucu tarafı).
- **Arama geçmişi eşitleme (gelen/giden):**
  - Android: `READ_CALL_LOG` ile telefondaki arama geçmişi okunur, **yalnız müşteri numarasıyla eşleşenler** (cihazda) mevcut `communications` iletişim zaman çizgisine yazılır (`/api/mobile/v1/calls`, toplu, dış kimlikle tekrar yazmayı önleyen). Google Play bu izin için ek beyan ister, reddedilme riski var; ret halinde yedek: uygulama içinden başlatılan aramalar + arama filtreleme.
  - iOS: arama geçmişine erişim YOK. Yalnız uygulamadan başlatılan aramalar (görüşme sonrası soru ile) ve santral kaydı.
  - Her iki platform + masaüstü için garantili yol: bulut santral (§4 S fazı). Santral tıkla-ara ile masaüstünden de arama başlatılabilir.
  - Masaüstü: eşitlenen kayıtlar müşteri kartındaki iletişim zaman çizgisinde (web `musteriler/[id]`, Gelen Kutusu çağrı sekmesi) görünür; ek geliştirme yalnız kaynağın mobil/santral olduğunu belirten etiket.

## 6. Fark yaratan özellikler (öncelik)

1. **Kayıp-Kaçak Kalkanı cebinde:** anında bildirim, tek dokunuşla aksiyon (A4-A5).
2. **Açıklanabilir eşleşme:** zorunlu/tercih ayrımı, "neden uyuyor", WhatsApp taslağı (A4-A5).
3. **Görüşme sonrası sıfır yazı:** sesli not → metin → randevu/görev/not önerisi + insan onayı (A4).
4. **Kanıtlı sabah brifingi + widget** (A4).
5. **Mevzuata hazır danışman:** Güvenli Ödeme Sistemi (1 Aralık 2026) ve EİDS/yetki belgesi kontrolü; sahip/hukuk kararı gerekir (A5 sonrası).
İkinci sıra: dijital kartvizit/QR, müşteri durum takibi. Ayrıntı ve rakip karşılaştırması: `RESEARCH_TR_CRM.md`, `RESEARCH_GLOBAL_CRM.md`.

## 7. Rehber ile senkron

- **A3:** Rehberden seçerek içe aktarma (cihazda eşleştirme, yalnız seçilenler gönderilir, `phone-rules` ile normalleştirme, mevcut numaraya tekrar kayıt yok).
- **A4:** "Rehbere kaydet" ("ES · Ad Soyad"); Android'de ayrı "EmlakSoft" rehber hesabı, iOS'ta etiketli grup; ofis ayarı ile açılıp kapatılabilir.
- Sürekli çift yönlü senkron kapsam dışı (çakışma/silme karmaşası).

## 8. Sahip kararları (A0)

1. Mağaza inceleme hesabı: HAFIZA §3 "demo danışman hesabı AÇILMAZ"; inceleme için izole, etiketli bir ofis gerekir.
2. Platform MFA (`PLATFORM_MFA_ENFORCEMENT`) mobil girişte nasıl çalışacak?
3. Google ile giriş açılırsa iOS'ta "Apple ile giriş" zorunlu olur.
4. Google Play hesap türü (bireysel hesapta 12 test kullanıcısı / 14 gün şartı).
5. Repo yapısı: aynı repoda `apps/mobile` + paylaşılan paket (öneri) mi, ayrı repo mu?
6. Bulut santral sağlayıcısı (S fazı) ve Android arama geçmişi iznine Play beyanı.
7. Meta hesapları (K fazı).
