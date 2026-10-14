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
- Ortam değişkenleri (yayından sonra, Vercel, hepsi `NEXT_PUBLIC_` olduğundan **redeploy gerekir**):
  - `NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL`: Chrome Web Store adresi (`https://chromewebstore.google.com/detail/...`).
  - `NEXT_PUBLIC_LISTING_EXTENSION_EDGE_URL`: Edge Add-ons adresi (`https://microsoftedge.microsoft.com/addons/detail/...`); yoksa Edge'e Chrome adresi verilir.
  - `NEXT_PUBLIC_LISTING_EXTENSION_ID`: mağazadaki eklenti kimliği (32 harf, a-p); sitenin eklentiyi `ping` ile algılaması için.
  - Eski adlar `..._STORE_URL` / `..._EDGE_STORE_URL` yedek olarak hâlâ okunur.
  Kurulum kartı tarayıcıyı algılar: Chrome/Brave/Arc/Opera/Vivaldi → "Chrome'a ekle", Edge → "Edge'e ekle", Safari/Firefox/mobil → "Bu özellik
  bilgisayarda Chrome veya Edge ile çalışır" + sayfa bağlantısını kopyala. Adres tanımsızsa ZIP + yerel kurulum yönergesine düşer. Yalnız resmi mağaza adresleri kabul edilir.
- **0.3.1 kurulum akışı (sertifika/exe yok):** mağazadan kurulum → `chrome.runtime.onInstalled` (yalnız `install`) EmlakSoft'u yeni sekmede
  `/app/ilan-kontrol?bagla=1` ile açar (köken: derleme zamanındaki birincil EmlakSoft kökeni; `tabs` izni gerekmez). Sayfa eklentiyi algılar ve tek
  "Bağla" düğmesini öne çıkarır; bağlama yine kullanıcı tıklamasıyla olur (otomatik bağlama/token YOK, `externally_connectable` yalnız `ping`).
  Oturum yoksa `/giris?next=/app/ilan-kontrol?bagla=1`. Bağlanınca içerik betiği köprüsünden `scan-request` gider ("şimdi tara"); sayfa ilerlemeyi
  ("İlanların okunuyor… 3/5 sayfa") ve sonucu (bulunan / eşleşen / onay bekleyen, hepsi bağlantılı) gösterir. Portal oturumu kapalıysa açık yönlendirme, okunamazsa "kontrol edilemedi" (asla "ilan yok").
- Ayrıştırıcı sağlığı için migration `20261008000400_lc_parser_telemetry.sql` (+ rollback) **sahibin yedek/PITR doğrulaması sonrası**
  `npm run db:migrate -- --only 20261008000400_lc_parser_telemetry.sql` ile uygulanır. Uygulanmadan eklenti ve sayfa çalışır; telemetri atlanır.

## 2. Mimari ve ilkeler (değişmez; testle kilitli: `worker/extension-contract.test.ts`)

- Eklenti kullanıcının KENDİ tarayıcısında, KENDİ portal oturumuyla, düşük hızla çalışır: iki kontrol arası ≥ 20 sn + sapma, saatte ≤ 60,
  günde ≤ 600. Kullanıcı ayarları (portal aç/kapa, çalışma saatleri, günlük sınır) YALNIZ kısar.
- CAPTCHA, giriş duvarı veya hız sınırı (401/403/429) görülürse 30 dk durur; aşmaya çalışmaz. Engel = "ilan yok" SAYILMAZ: sonuç
  "kontrol edilemedi" (`blocked`/`error`) olur. "Yok" yalnız 404/410 ya da portalın açık "yayından kaldırıldı" ibaresi/durumuyla ve sunucuda
  bağımsız kontrollerle teyit edilir.
- Sunucu portala hiç bağlanmaz. Eklentiye oturum anahtarı verilmez: içerik betiği yalnız EmlakSoft kökenlerinde çalışır ve aynı kökenli, özel başlıklı
  isteklerle açık oturumu kullanır. `externally_connectable` (0.3.0) yalnız EmlakSoft kökenleri için ilan edilir ve yalnız salt-okunur `ping` yanıtlar
  (kurulu mu, sürüm, bağlı mı); bağlama ve veri yolu değişmedi. **Günlük tarama (0.3.0):** `chrome.alarms` saatte bir uyanır; son TAM taramadan 20 saat geçtiyse
  ofisin kendi "ilanlarım" listesini (sayfalama dahil, aynı hız kuralı) okur, sonucu bir EmlakSoft sekmesi açıkken yükler. Tarayıcı kapalıyken çalışmaz;
  kaçırılan gün ilk açılışta telafi edilir. Liste ancak portalın gösterdiği toplam ilan sayısına ulaşıldıysa "tam" sayılır; "ilan kalktı" en az 12 saat arayla
  iki tam taramada görülmeyince. `portal-rules.json` içindeki `storeStartUrls`/`storeTotal` kalıpları gerçek portalda **doğrulanmadı**.
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
   `NEXT_PUBLIC_LISTING_EXTENSION_CWS_URL` olarak yaz ve redeploy et: kurulum sayfası "Chrome'a ekle" düğmesini gösterir.

## 4. İzin gerekçeleri (mağaza formu için)

| İzin | Gerekçe |
| --- | --- |
| `storage` | Bağlantı durumu, ayarlar (portal aç/kapa, çalışma saatleri, günlük sınır), hız sayaçları, yerel sonuç geçmişi ve gönderilemeyen sonuç kuyruğu tarayıcıda yerel saklanır. |
| `alarms` | Manifest V3 arka plan işçisi uykuya geçer; dakikalık alarm araç çubuğu rozetini ve bağlantı/engel beklemesi durumunu günceller. |
| Ana makine: `https://*.sahibinden.com/*`, `https://*.hepsiemlak.com/*`, `https://*.emlakjet.com/*` | Kullanıcının kendi portal oturumuyla, kendi ilanlarının sayfasını düşük hızla okuyup yayında olup olmadığını denetlemek (tek amaç). |
| İçerik betiği: `https://emlaksoft.vercel.app/*` (+ ofisin alan adı) | EmlakSoft sayfasıyla (aynı kökenli, kullanıcının açık oturumu) konuşmak: kontrol işini almak, sonucu bildirmek, "Eklentiyi bağla" isteğini almak. |

Talep EDİLMEYEN: `tabs`, `cookies`, `webRequest`, `<all_urls>`, isteğe bağlı izin. `activeTab` + `scripting` 0.4.0'dan beri vardır ve 0.6.0'da AYNI kalır (aşağıdaki §4b). Uzaktan kod yüklenmez (tüm betikler pakette).

## 4b. Tek amaç beyanı ve izin gerekçeleri: 0.6.0 (GÜNCEL; mağazaya gönderilecek paket — gönderim sahibin işi)

**Mağaza sırası (sahip kararı):** 0.5.0 mağazaya GÖNDERİLMEZ. Mağazada yayında olan 0.4.0'dan sonraki ilk paket **0.6.0**'dır ve tek seferde gönderilir;
inceleme farkı 0.4.0 → 0.6.0'dır: portal aktarımı (form doldurma, fotoğraf, ilanlarımı al) ile öğrenen form kuralları BİRLİKTE incelenir. İnceleme notu iki
özelliği birlikte anlatır; demo hesap örnek veriyle gerçek bir "EmlakSoft'tan doldur" denemesi yaptırabilmelidir (demo kiracı öğrenme uygunluğundan dışlanır).

0.6.0, 0.4.0 ile **aynı izin listesini** kullanır (`storage`, `alarms`, `activeTab`, `scripting` + üç portal alanı + EmlakSoft içerik betiği; sözleşme testi
`worker/extension-contract.test.ts` sabit listeyle kilitler): Chrome mevcut kurulumları "yeni izin onayı" için devre dışı bırakmaz. ECDSA doğrulaması
(`crypto.subtle`) ve `chrome.storage.session` yeni izin istemez. Arka planın ağ isteği hâlâ TEKTİR (portal okuması); kurallar yalnız EmlakSoft sayfasındaki
içerik betiğinden, aynı kökenli oturumlu uçtan alınır.

**0.6.1 (EP1, portal üyeliği):** mağazaya gönderilecek paket artık **0.6.1**'dir (0.6.0 + üyelik süzgeci; izin listesi ve tek amaç AYNI). Eklenti
yalnız sunucunun bildirdiği portallara (ofis üye + otomatik kontrol açık; eşleşme yanıtı ve kural yenileme başlığında gelir) istek atar; liste yoksa ya da
boşsa hiçbir portala istek atmaz (eski "varsayılan açık" kalktı). "Giriş istedi" taraması sunucuya ilansız bildirilir. 0.6.0 yüklü kurulumlar uygulama
içinde "güncelleme var" görür. Canlı doğrulama (yayın sonrası, sahip/orkestratör): üyeliği "Üye değiliz" olan bir portal için 24 saat boyunca
`extension-scan` logunda o portala SIFIR istek görülmeli.

**Kısa açıklama (manifest `description`, ≤ 132 karakter; sınır sözleşme testiyle kilitli; 0.5.0 ile aynı):**
"Portföyünüzü portallarla eşitler: ilanları karşılaştırır, portal formunu onayınızla doldurur, ilanlarınızı EmlakSoft'a alır."

**Tek amaç (mağaza "Tek amaç" alanı; privacy A):**
> EmlakSoft portföyünüz ile ilan portallarındaki (sahibinden.com, hepsiemlak.com, emlakjet.com) kendi ilanlarınızı eşitler: ilanlarınızın yayında olup olmadığını ve
> fiyat/durum farkını karşılaştırır, portalın "İlan ver" formunu sizin onayınızla portföy bilgileriyle doldurur ve portalda zaten yayında olan ilanlarınızı EmlakSoft'a alır.
> Form alanlarının eşleştirmesi, izin veren ofislerin düzeltmelerinden toplu olarak iyileşir; eşleştirme kuralları imzalı veri olarak gelir, kod indirilmez.

**İzin gerekçeleri (mağaza formu; privacy A):**

| İzin | Gerekçe |
| --- | --- |
| `storage` | Bağlantı durumu, ayarlar, hız sayaçları, gönderilemeyen sonuç kuyruğu; "Portala aktar" için kodu tüketilmiş paket (küçük); imzası doğrulanmış form eşleştirme kuralları (son iyi sürüm) ve izin verilmişse gönderilmeyi bekleyen form geri bildirimi yerel. Aktarım fotoğrafları ve doldurma anlık görüntüsü (değer değil, yalnız özet) yalnız oturum deposunda (tarayıcı kapanınca silinir). |
| `alarms` | Manifest V3 arka plan işçisi uykuya geçer; dakikalık alarm rozeti/bağlantı durumunu ve günlük taramayı tazeler. Kural tazeleme için yeni alarm yoktur. |
| `activeTab` | Yalnız eklenti penceresindeki bir düğmeye bastığınızda, ÖNÜNÜZDE AÇIK olan portal sekmesine geçici erişim: (1) formu doldurmak ("EmlakSoft'tan doldur"), (2) "Yayından önce kontrol et" ile doldurulan alanların şimdiki durumunu okumak (değer değil, özet), (3) "İlanlarım" sayfasındaki görünen listeyi okumak, (4) tek bir ilanı kaydetmek. Arka planda sekme gezilmez. |
| `scripting` | `activeTab` ile verilen o tek sekmede, yalnız düğmeye basıldığında küçük bir paket-içi işlev çalıştırmak: form alanlarını yazmak, fotoğrafları dosya alanına eklemek, doldurulan alanları özet olarak okumak, listeyi okumak. Sayfa gönderilmez, "Yayınla"ya eklenti basmaz, parola/e-posta/telefon alanlarına dokunulmaz. Uzaktan kod yüklenmez: sunucudan gelen form kuralları regex, seçici, URL ya da betik içermeyen, imzalı düz veridir. |
| Ana makine: sahibinden / hepsiemlak / emlakjet | Kullanıcının kendi oturumuyla kendi ilanlarının sayfasını düşük hızla okuyup yayında olup olmadığını denetlemek (günlük kontrol). |
| İçerik betiği: EmlakSoft alanı | EmlakSoft sayfasıyla (aynı kökenli, açık oturum) konuşmak: kontrol işi, aktarım paketini almak, yayın sonrası ilan no/URL'yi geri bağlamak, seçilen ilanları göndermek, imzalı form kurallarını almak ve izin verilmişse form geri bildirimini göndermek. |

**Uzak kod beyanı (mağaza "Are you using remote code?"):** HAYIR. Tüm JavaScript pakettedir. Sunucudan yalnız imzalı JSON veri gelir (etiket eş anlamlıları, seçenek
takma adları, alan durumu, form parametreleri); eklenti bu veriyi katı şema (`validateRuleSet`, bilinmeyen anahtar → ret) ve ECDSA P-256 imzasıyla doğrular,
yalnız metin eşitliği/kelime karşılaştırmasında kullanır. `eval`, `new Function`, değişkenle `RegExp` ve dinamik `import(` sözleşme testiyle yasaktır.

**Veri kullanımı notu (Limited Use):** portföy bilgisi ve fotoğrafları yalnız siz "Portala aktar" dediğinizde, açtığınız portal sekmesine yazılır; ilan numarası ve URL EmlakSoft'a
döner. Portaldan alınan ilan bilgisi (başlık, fiyat, oda, m², konum) yalnız sizin seçtiğiniz ilanlar için ve yalnız EmlakSoft ofisinize gönderilir; telefon ve kişi adı alınmaz.
Form geri bildirimi yalnız açık izinle ve yalnız form yapısı/sonuç türü olarak gider (§5 eki). Veri satılmaz, reklam/analitik için kullanılmaz.

**Mağazada ayrıca göster:** "Eklenti formu doldurur; **Yayınla düğmesine siz basarsınız.** Kategori, konum ve harita adımlarını siz seçersiniz." (Kullanıcı onayı olmadan mesaj/ilan gönderme
yasağıyla çelişmediğini gösterir.)

**Canlı doğrulama (0.6.0):** form kuralları artık pakete gömülü TOHUM (`seed-rules.ts`, bugünkü `rules.ts`'ten, durum `unverified`) + sunucudan gelen imzalı sürümlerdir.
Elle bir kerelik "verified:true" adımı yerine **sürekli öğrenme** vardır: ofislerin "Yayından önce kontrol et" / "EmlakSoft'a bağla" düzeltmeleri toplanır, eşik dolan öneri
yeni sürüm olur. Başlangıçta uygun gerçek ofis sayısı az olduğundan **ilk yayında onay yolu personeldir** (`portal_rules.auto_publish=false`); ayrıntı `docs/runbooks/PORTAL_KURALLARI.md`.

## 5. Gizlilik politikası taslağı ve veri kullanımı beyanı (hukuk onayı sahibin işi)

> **EmlakSoft İlan Kontrol: Gizlilik politikası.** Eklenti, EmlakSoft kullanıcısının portal ilanlarının (sahibinden.com, hepsiemlak.com, emlakjet.com)
> hâlâ yayında olup olmadığını denetlemesine yardım eder. Denetim yalnız sizin tarayıcınızda, sizin portal oturumunuzla ve düşük hızla yapılır; sayfaları
> sunucularımız açmaz.
>
> **Topladığımız veri.** Denetlenen ilan için: ilan numarası, ilan başlığı, fiyat, yayın durumu ve (portalın sayfada gösterdiği) ilan sahibi adı. Bu bilgi yalnız sizin
> EmlakSoft ofisinize gönderilir. Ayrıca kimlik içermeyen kullanım sayaçları (portal adı, ayrıştırıcı sürümü, sonucun türü, hata kodu) gönderilir; amaç ayrıştırıcının
> bozulup bozulmadığını görmektir.
>
> **Portala aktarma ve ilan alma (0.5.0).** Siz "Portala aktar" dediğinizde portföy bilgileriniz ve fotoğraflarınız yalnız açtığınız portal sekmesindeki forma yazılır; portala gönderme
> (Yayınla) işlemini siz yaparsınız, yayınlanan ilanın numarası ve bağlantısı EmlakSoft'a geri döner. "İlanlarımı EmlakSoft'a al" dediğinizde yalnız seçtiğiniz ilanların başlık,
> fiyat, oda, m², konum ve ilan numarası ofisinize gönderilir; telefon ve kişi adı alınmaz.
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

> **EK (0.6.0) — gizlilik politikasına ve mağaza gizlilik alanına BİREBİR girecek paragraf (privacy C; `src/app/gizlilik/page.tsx` bölüm 6 ile aynı, sözleşme testi kilitler):**
>
> **Form eşleştirmesini iyileştirme (0.6.0, isteğe bağlı):** Yalnız eklenti penceresinde açıkça izin verirseniz (varsayılan kapalı), eklenti doldurduğu portal formunun yapısını EmlakSoft'a gönderir: alana bağlı etiket, alan türü, portalın kendi seçenek metinleri, zorunlu işareti, alanın doldurulup doldurulmadığı ve yayından önce değiştirip değiştirmediğiniz (değişmedi, biçimi değişti, yeniden yazıldı, boşaltıldı ya da seçtiğiniz portal seçeneği). Alanlara yazılan değerler (başlık, açıklama, fiyat, adres), telefon, e-posta, ad soyad ve iletişim alanları hiçbir zaman gönderilmez; rakam dizisi, e-posta ya da bağlantı içeren etiket ve seçenekler eklentide ve sunucuda ayrıca ayıklanır. Bu bilgi yalnız portal formlarının doğru doldurulması için ve ofisler arasında toplu olarak kullanılır; iyileştirilen eşleştirme kuralları eklentiye EmlakSoft imzalı veri olarak döner, uzaktan kod indirilmez. Platform yöneticisi istediğinde, en az iki ofiste görülen ve henüz eşleşmeyen alan etiketleri ile seçenekleri (kullanıcı değeri olmadan, kişisel veri maskelenerek) eşleştirme önerisi üretmek için alt işleyenimiz OpenAI'ye iletilir. İzni eklenti penceresinden istediğiniz an geri alabilirsiniz; geri aldığınızda gönderilmeyi bekleyen kayıtlar tarayıcınızdan silinir. Sunucudaki alan gözlemleri en çok 180 gün, form raporları en çok 90 gün saklanır.

Bu ekle birlikte: rıza kartı metni (eklenti penceresi, privacy B) OpenAI'ye maskelenmiş aktarımı da söyler; belirgin bildirim yalnız politikada durmaz (User Data FAQ).
Metindeki "en az iki ofiste" sözü `portal_rules.ai_min_tenants ≥ 2` ayarına dayanır: bu ayar 2'nin altına İNDİRİLMEZ (`docs/runbooks/PORTAL_KURALLARI.md` §4).

Chrome "veri kullanımı" beyanı (0.6.0): Toplanan veri türleri →
- **Kullanıcı etkinliği: EVET** (izin verilmişse: formdaki alanın doldurulup değiştirilmediği ve seçilen portal seçeneği gibi form etkileşim sonuçları);
- **Web sitesi içeriği: EVET** (ilan alanları; izin verilmişse portal formunun alan etiketleri ve seçenek metinleri);
- **Web geçmişi: HAYIR**;
- "Kişisel olarak tanımlanabilir bilgi" HAYIR (ilan sahibi adı portalda herkese açık ilan bilgisidir; form geri bildiriminde ad/telefon/e-posta alanları hiç gönderilmez).
Üç taahhüt kutusu işaretlenir (satılmaz, amaç dışı kullanılmaz, kredi/borç amacıyla kullanılmaz).

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

> **0.6.0 notu (form doldurma):** canlı doğrulama artık **sürekli öğrenme**dir; ilk yayında **personel onayı** ile ilerler. Portal "İlan ver" formu için
> tek seferlik `verified:true` adımı yoktur: tohum kurallar `unverified` başlar, izin veren ofislerin düzeltmeleri toplanır, eşiği dolan öneri
> `/admin/sistem?sekme=portal-kurallari` ekranında personel onayıyla yeni imzalı sürüm olur (`portal_rules.auto_publish` kapalı). Alan durumu ancak ofis
> oylarıyla `verified` olur. Aşağıdaki adımlar ilan KONTROLÜ ayrıştırıcıları (`portal-rules.json`) içindir ve aynen geçerlidir. Ayrıntı: `docs/runbooks/PORTAL_KURALLARI.md`.

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
5. **Form kuralları (0.6.0+) için mağaza GEREKMEZ:** etiket, seçenek takma adı, alan durumu ve form parametresi değişiklikleri veritabanına yeni imzalı sürüm
   olarak girer ve eklentiye kendiliğinden iner (`docs/runbooks/PORTAL_KURALLARI.md`). Yeni paket YALNIZ şu durumlarda gerekir: eşleme motoru değişti
   (`fill-plan.ts`, `rules-engine.ts`), kural formatı değişti (`FORM_RULES_FORMAT`/`FORM_RULES_ENGINE` artar; eski eklenti yeni formatı reddeder, son iyi sürümde
   kalır) ya da pakete gömülü açık anahtar listesi (`rule-keys.ts`) değişti.
6. **Mağaza paketi:** `npx tsx scripts/build-extension.ts --release` (ya da `npm run build:extension -- --release`). `RULE_PUBLIC_KEYS` boşsa HATA verir; derleme
   çıktısındaki "kural formatı: f1 (format 1) · imza anahtarları: …" satırı yüklenecek ZIP'teki anahtar kimliklerini gösterir.

### 8b. 0.6.0 sahip kontrol listesi (sırayla; hepsi işaretlenmeden ZIP yüklenmez)

- [ ] Anahtar üretildi: `npx tsx scripts/gen-portal-rules-keypair.ts` (çıktı yalnız ekrana; dosyaya yazılmaz).
- [ ] Env girildi: `PORTAL_RULES_SIGNING_KEY` (PKCS8 PEM) ve `PORTAL_RULES_SIGNING_KID` → `.env.production` (sahip).
- [ ] `src/lib/portal-transfer/rule-keys.ts` dolu: açık JWK `{ "<kid>": {...} }` yapıştırıldı, commit edildi (paket derlenmeden ÖNCE).
- [ ] P1 migration'ları canlıda: `20261013002000_portal_rules_core` → `002010_portal_rules_rpcs` → `002020_portal_rules_learn` (yedek + dry-run sonrası).
- [ ] Uygulama deploy edildi (kural/gözlem uçları ve yönetim sekmesi).
- [ ] Tohum v1 yayında: `/admin/sistem?sekme=portal-kurallari` → "Tohumu yayınla (sürüm 1)" (üç portal).
- [ ] Paketlenmemiş eklentide imza doğrulandı: geliştirici modunda yükle, EmlakSoft sayfasını aç; açılır pencerede kural sürümü 1 görünür; bozuk/yabancı imzalı set reddedilir.
- [ ] `--release` ile ZIP üretildi ve Chrome Web Store'a (sonra Edge) yüklendi; §4b metinleri ve §5 eki mağaza formuna birebir girildi.

## 9. Edge Add-ons

1. Partner Center: <https://partner.microsoft.com/dashboard/microsoftedge> hesabı aç (ücretsiz).
2. Aynı ZIP'i yükle (Manifest V3, Chromium ≥ 116 uyumlu; değişiklik gerekmez). Listeleme metni, ikon, ekran görüntüleri §3/§6 ile aynıdır; gizlilik politikası URL'si zorunlu.
3. Yayın sonrası adresi `NEXT_PUBLIC_LISTING_EXTENSION_EDGE_URL` olarak Vercel'e yaz ve redeploy et.

## 10. Sorun giderme

- "Eklenti kurulu ama bağlı değil": açılır pencerede ya da sayfada "Bağlan"a bas. Bağlantı 30 gün EmlakSoft oturumu görülmezse düşer.
- Sürekli "Portal engeli: bekleniyor": portal CAPTCHA/hız sınırı gösterdi; 30 dk sonra kendiliğinden devam eder. Saatlik/günlük sınırlar ayrıca uygulanır.
- "Sayfa yapısı tanınmadı" çoğalıyor: portal tasarımı değişmiş olabilir → §7.3.
- Rozet: `✓` aktif, `II` duraklatıldı, kırmızı sayı = uyarı (kırmızı/sarı portal sayısı), `?` bağlı değil.
