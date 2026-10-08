# İlan Kontrol tarayıcı eklentisi: yayın, dağıtım ve geliştirici notları

Kapsam: `extensions/emlaksoft-ilan-kontrol/` (Manifest V3; Chrome ve Edge ≥ 116). Sahip işi: mağaza hesapları ve gönderim. Bu belge
kod tarafının hazırladıklarını ve sahibin yapacaklarını ayırır. **Önemli:** portal ayrıştırıcıları (sahibinden, Hepsiemlak,
Emlakjet) gerçek portal sayfalarına karşı DOĞRULANMADI; kurallar `verified:false`. Bkz. §7.

## 1. Geliştirici notu (son kullanıcı ekranında teknik komut YOKTUR)

```bash
npm run build:extension      # tip denetimi + derleme + sürüm numaralı ZIP
```

Çıktılar (hiçbiri depoya girmez):

| Yol | İçerik |
| --- | --- |
| `extensions/emlaksoft-ilan-kontrol/dist/` | açılmış paket (geliştirici modunda "Paketlenmemiş öğe yükle") |
| `extensions/emlaksoft-ilan-kontrol/release/emlaksoft-ilan-kontrol-<sürüm>.zip` | mağazaya yüklenecek / elle dağıtılacak ZIP |
| `public/downloads/emlaksoft-ilan-kontrol-<sürüm>.zip` + `.json` | uygulama içi "Eklentiyi indir (ZIP)" ucunun okuduğu kopya (sha256 ve boyut) |

- `npm run build` (`prebuild`) bu paketi **yumuşak** üretir (`--soft`: hata verirse uyarır, uygulama derlemesini engellemez). Vercel'de
  `NEXT_PUBLIC_APP_URL` tanımlıysa eklentinin içerik betiği o kökeni de kapsar (varsayılan: `https://emlaksoft.vercel.app`).
- İndirme ucu: `GET /api/app/ilan-kontrol/eklenti.zip` (oturum + `portals/view`). Paket yoksa 404; sayfa "henüz hazır değil" der.
  `next.config.ts` `outputFileTracingIncludes` paketi sunucu işlevine dahil eder.
- Sürüm tek kaynak: `src/lib/listing-control/worker/extension-release.ts` (`EXTENSION_VERSION`). `manifest.base.json` `version` ile
  eşit olmalı (derleme ve test kilitler).
- İkonlar marka işaretinden üretilir: `npx tsx scripts/generate-extension-icons.ts` (16/32/48/128 PNG, depoya girer).
- Ayrıştırıcı kuralları: `src/lib/listing-control/adapters/html/portal-rules.json` (sürümlü). Motor sürümü `PARSER_ENGINE_VERSION`
  (`create.ts`). Sonuçla birlikte `parserVersion = motor@kural` gider.
- Mağaza adresleri (yayından sonra, Vercel ortam değişkeni, **redeploy gerekir**): `NEXT_PUBLIC_LISTING_EXTENSION_STORE_URL`
  (Chrome) ve isteğe bağlı `NEXT_PUBLIC_LISTING_EXTENSION_EDGE_STORE_URL`. Değişkenler tanımlanınca kurulum sayfasında "Chrome'a ekle" /
  "Edge'e ekle" tek tık düğmeleri görünür; tanımsızsa ZIP yolu gösterilir. Yalnız resmi mağaza adresleri kabul edilir.
- Ayrıştırıcı sağlığı için migration `20261008000400_lc_parser_telemetry.sql` (+ rollback) **sahibin yedek/PITR doğrulaması sonrası**
  `npm run db:migrate -- --only 20261008000400_lc_parser_telemetry.sql` ile uygulanır. Uygulanmadan eklenti ve sayfa çalışır; telemetri atlanır.

## 2. Mimari ve ilkeler (değişmez; testle kilitli: `worker/extension-contract.test.ts`)

- Eklenti kullanıcının KENDİ tarayıcısında, KENDİ portal oturumuyla, düşük hızla çalışır: iki kontrol arası ≥ 20 sn + sapma, saatte ≤ 60,
  günde ≤ 600. Kullanıcı ayarları (portal aç/kapa, çalışma saatleri, günlük sınır) YALNIZ kısar.
- CAPTCHA, giriş duvarı veya hız sınırı (401/403/429) görülürse 30 dk durur; aşmaya çalışmaz. Engel = "ilan yok" SAYILMAZ: sonuç
  "kontrol edilemedi" (`blocked`/`error`) olur. "Yok" yalnız 404/410 ya da portalın açık "yayından kaldırıldı" ibaresi/durumuyla ve sunucuda
  bağımsız kontrollerle teyit edilir.
- Sunucu portala hiç bağlanmaz. Eklentiye oturum anahtarı verilmez: içerik betiği yalnız EmlakSoft kökenlerinde çalışır ve aynı kökenli, özel başlıklı
  isteklerle açık oturumu kullanır. `externally_connectable` ilan edilmez.
- **Tek tuş / bağlama:** kullanıcı "Bağlan" (açılır pencere) ya da "Eklentiyi bağla" (uygulama içi sayfa) demeden HİÇBİR kontrol yapılmaz. Sayfadan gelen
  bağlan isteği: aynı pencere + aynı köken + izinli EmlakSoft kökeni + gerçek kullanıcı etkinliği + tek kullanımlık nonce doğrulanır. Bağlantı, EmlakSoft oturumu
  30 gün görülmezse düşer.
- Kişisel veri en az: sunucuya yalnız ilan no, başlık, fiyat, durum, ilan sahibi adı (mevcut yol) ve ayrıştırıcı SAYAÇLARI (portal, sürüm, sınıf, katman, hata kodu) gider.
  Eklentinin yerel geçmişinde yalnız ilan no + sonuç türü + hata kodu tutulur.
- Güvenilirlik: `chrome.alarms` (dakikalık) rozet/bayrak tazeler; çoklu sekmede tek lider (kira 90 sn); sonuç gönderimi başarısızsa (çevrimdışı/5xx/oturum)
  yerel kuyruğa alınır ve AYNI iş kimliğiyle üstel geri çekilmeyle (30 sn → en çok 15 dk) yeniden denenir; sunucu `lc_worker_complete` iş kimliğine göre idempotenttir.
  Portal bu yeniden denemede tekrar sorgulanmaz.

## 3. Chrome Web Store yayın adımları

1. Geliştirici hesabı: <https://chrome.google.com/webstore/devconsole> (tek seferlik kayıt ücreti; hesap sahibi ofis/şirket). 2 adımlı doğrulama açık olmalı.
2. `npm run build:extension` → `extensions/emlaksoft-ilan-kontrol/release/emlaksoft-ilan-kontrol-<sürüm>.zip` dosyasını "Yeni öğe" olarak yükle.
3. Mağaza listesi: ad "EmlakSoft İlan Kontrol", kısa açıklama (≤ 132 karakter), ayrıntılı açıklama (§6 taslağı), kategori "İş araçları", dil Türkçe.
4. Görseller: 128×128 ikon (paketteki `icons/icon-128.png`), en az 1 (öneri 5) ekran görüntüsü 1280×800, küçük tanıtım kutusu 440×280.
5. "Gizlilik uygulamaları" sekmesi: tek amaç beyanı, izin gerekçeleri (§4), veri kullanımı beyanı (§5), gizlilik politikası URL'si (§5 metni yayımlanmış sayfa).
6. Dağıtım: önce "Gizli (yalnız belirli kullanıcılar)" ya da "Listelenmemiş" ile ofislerde dene; sonra "Herkese açık".
7. İnceleme sonucu (genelde birkaç gün; geniş host izni olmadığı için hızlı olması beklenir) sonrası mağaza adresini Vercel'e
   `NEXT_PUBLIC_LISTING_EXTENSION_STORE_URL` olarak yaz ve redeploy et: kurulum sayfası "Chrome'a ekle" düğmesini gösterir.

## 4. İzin gerekçeleri (mağaza formu için)

| İzin | Gerekçe |
| --- | --- |
| `storage` | Bağlantı durumu, ayarlar (portal aç/kapa, çalışma saatleri, günlük sınır), hız sayaçları, yerel sonuç geçmişi ve gönderilemeyen sonuç kuyruğu tarayıcıda yerel saklanır. |
| `alarms` | Manifest V3 arka plan işçisi uykuya geçer; dakikalık alarm araç çubuğu rozetini ve bağlantı/engel beklemesi durumunu günceller. |
| Ana makine: `https://*.sahibinden.com/*`, `https://*.hepsiemlak.com/*`, `https://*.emlakjet.com/*` | Kullanıcının kendi portal oturumuyla, kendi ilanlarının sayfasını düşük hızla okuyup yayında olup olmadığını denetlemek (tek amaç). |
| İçerik betiği: `https://emlaksoft.vercel.app/*` (+ ofisin alan adı) | EmlakSoft sayfasıyla (aynı kökenli, kullanıcının açık oturumu) konuşmak: kontrol işini almak, sonucu bildirmek, "Eklentiyi bağla" isteğini almak. |

Talep EDİLMEYEN: `tabs`, `cookies`, `webRequest`, `scripting`, `activeTab`, `<all_urls>`. Uzaktan kod yüklenmez (tüm betikler pakette).

## 5. Gizlilik politikası taslağı ve veri kullanımı beyanı (hukuk onayı sahibin işi)

> **EmlakSoft İlan Kontrol: Gizlilik politikası.** Eklenti, EmlakSoft kullanıcısının portal ilanlarının (sahibinden.com, hepsiemlak.com, emlakjet.com)
> hâlâ yayında olup olmadığını denetlemesine yardım eder. Denetim yalnız sizin tarayıcınızda, sizin portal oturumunuzla ve düşük hızla yapılır; sayfaları
> sunucularımız açmaz.
>
> **Topladığımız veri.** Denetlenen ilan için: ilan numarası, ilan başlığı, fiyat, yayın durumu ve (portalın sayfada gösterdiği) ilan sahibi adı. Bu bilgi yalnız sizin
> EmlakSoft ofisinize gönderilir. Ayrıca kimlik içermeyen kullanım sayaçları (portal adı, ayrıştırıcı sürümü, sonucun türü, hata kodu) gönderilir; amaç ayrıştırıcının
> bozulup bozulmadığını görmektir.
>
> **Toplamadığımız veri.** Portal şifreniz, çerezleriniz, kredi kartı, TC kimlik, telefon, e-posta, gezinme geçmişiniz, sayfaların tam içeriği. Eklenti EmlakSoft oturum
> anahtarınızı okumaz veya saklamaz.
>
> **Saklama ve paylaşma.** Ayarlarınız ve yerel geçmişiniz yalnız tarayıcınızda tutulur; eklentiyi kaldırınca silinir. Veri satılmaz, reklam amaçlı kullanılmaz,
> üçüncü kişilerle paylaşılmaz. Eklenti, portal bir doğrulama (CAPTCHA), giriş veya hız sınırı gösterirse durur ve bunu aşmaya çalışmaz.
>
> **Kontrol sizde.** "Bağlan" demeden eklenti hiçbir ilanı kontrol etmez; araç çubuğundaki anahtarla duraklatabilir, "Bağlantıyı kes" ile durdurabilirsiniz.
> Portal kullanım şartlarına uygunluk ofisin sorumluluğundadır.
>
> İletişim: <destek e-posta adresi> · Veri sorumlusu: <şirket unvanı> · Güncelleme tarihi: <tarih>

Chrome "veri kullanımı" beyanı: Toplanan veri türleri → "Web geçmişi" HAYIR; "Kişisel olarak tanımlanabilir bilgi" HAYIR (ilan sahibi adı portalda herkese açık
ilan bilgisidir; yine de formda "Web sitesi içeriği" işaretlenir); "Web sitesi içeriği" EVET (yalnız ilan alanları). Üç taahhüt kutusu işaretlenir (satılmaz, amaç dışı
kullanılmaz, kredi/borç amacıyla kullanılmaz).

## 6. Ekran görüntüsü listesi (1280×800)

1. Açılır pencere, bağlı ve çalışıyor (yeşil durum, bugün/hafta, sıradaki kontrol, saatlik/günlük limit göstergesi).
2. Açılır pencere, portal sağlığı (yeşil/sarı/kırmızı) ve "kontrol edilemedi" nedenleri.
3. Açılır pencere, ayarlar (portal aç/kapa, çalışma saatleri, günlük sınır).
4. EmlakSoft `/app/ilan-kontrol/eklenti` sayfası, 3 adımlı kurulum sihirbazı ve canlı durum kartı.
5. EmlakSoft ilan kontrol panosu: portaldan kalkan ilan uyarısı.
Her görüntüde örnek (demo) veri kullan; gerçek müşteri/ilan sahibi verisi görünmesin.

Mağaza açıklaması taslağı: "EmlakSoft açıkken portal ilanlarınızın hâlâ yayında olup olmadığını kendi tarayıcınızda, düşük hızla ve kendi oturumunuzla
denetler. Portaldan kalkan ama kaydı işlem görmeyen ilan EmlakSoft'ta uyarı olarak düşer. Siz bağlanmadan çalışmaz; doğrulama (CAPTCHA) veya hız sınırı görürse durur."

## 7. Gerçek portal sayfasına karşı doğrulama (YAYIN ÖNCESİ ZORUNLU; henüz yapılmadı)

Ayrıştırıcılar yalnız temsili (sentetik) sayfalarla test edildi; `portal-rules.json` `verified:false`. Gerçek sayfalar JSON-LD/meta/durum JSON'u/DOM düzeni açısından
farklı olabilir. Güvenli düşüş: tutmayan kalıp "kontrol edilemedi" üretir, yanlış "ilan yok" üretmez.

1. Test ofisinde eklentiyi geliştirici modunda yükle, "Bağlan" de.
2. Her portal için en az: yayında bir ilan, kaldırılmış bir ilan (kendi eski ilanın), var olmayan numara; sonuçları açılır pencere "Son sonuçlar" ve
   `/app/ilan-kontrol/eklenti` "Ayrıştırıcı sağlığı" tablosundan izle.
3. "Yapı tanınmadı" ve "kısmi okuma" oranı yüksekse (özellikle yeni ayrıştırıcı sürümünde) `portal-rules.json` kalıplarını gerçek sayfaya göre güncelle, `version` artır,
   `verified` alanını ancak her portal için yukarıdaki üç durum doğrulandıktan sonra `true` yap.
4. Portal kullanım şartları ve robots politikası ofis/şirket hukuk sorumluluğundadır; sayfadaki yasal not kalkmaz.

## 8. Sürüm yükseltme akışı

1. `src/lib/listing-control/worker/extension-release.ts` `EXTENSION_VERSION` ve `manifest.base.json` `version` değerlerini birlikte artır (örn. 0.2.0 → 0.2.1). Ayrıştırıcı kuralı değiştiyse
   `portal-rules.json` `version` da artar (motor@kural sürümü yeni telemetri satırı açar, eski/yeni karşılaştırılabilir).
2. `npm run build:extension`; ZIP'i yeni sürümle Chrome Web Store (Paket → "Yeni paket yükle") ve Edge Add-ons'a yükle. Sürüm numarası öncekinden BÜYÜK olmalıdır.
3. Uygulama (Vercel) yeniden dağıtılır: `prebuild` yeni ZIP'i üretir; kurulu eklenti eski sürümdeyse kurulum sayfası "yeni sürüm var" uyarısı ve indirme düğmesi gösterir.
   Mağaza kurulumları tarayıcı tarafından otomatik güncellenir; elle (ZIP) kurulumlar kullanıcıdan yeniden yükleme ister.
4. Yükseltme sonrası ilk gün "Ayrıştırıcı sağlığı" tablosunda yeni sürümün "kontrol edilemedi" oranına bak; belirgin kötüyse mağazada önceki sürüme dön / kuralı düzelt.

## 9. Edge Add-ons

1. Partner Center: <https://partner.microsoft.com/dashboard/microsoftedge> hesabı aç (ücretsiz).
2. Aynı ZIP'i yükle (Manifest V3, Chromium ≥ 116 uyumlu; değişiklik gerekmez). Listeleme metni, ikon, ekran görüntüleri §3/§6 ile aynıdır; gizlilik politikası URL'si zorunlu.
3. Yayın sonrası adresi `NEXT_PUBLIC_LISTING_EXTENSION_EDGE_STORE_URL` olarak Vercel'e yaz ve redeploy et.

## 10. Sorun giderme

- "Eklenti kurulu ama bağlı değil": açılır pencerede ya da sayfada "Bağlan"a bas. Bağlantı 30 gün EmlakSoft oturumu görülmezse düşer.
- Sürekli "Portal engeli: bekleniyor": portal CAPTCHA/hız sınırı gösterdi; 30 dk sonra kendiliğinden devam eder. Saatlik/günlük sınırlar ayrıca uygulanır.
- "Sayfa yapısı tanınmadı" çoğalıyor: portal tasarımı değişmiş olabilir → §7.3.
- Rozet: `✓` aktif, `II` duraklatıldı, kırmızı sayı = uyarı (kırmızı/sarı portal sayısı), `?` bağlı değil.
