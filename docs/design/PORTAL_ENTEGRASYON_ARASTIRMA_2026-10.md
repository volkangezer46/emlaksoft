# Portal Entegrasyonu: Araştırma ve Tasarım Raporu (2026-10)

> Durum: TASARIM. Kod değişikliği yok. Tarih: 2026-10-12.
> Kullanıcının isteği: "İlan portallarından içe aktarma, portala dışa aktarma, portal ile EmlakSoft karşılaştırması. Örneğin sahibinden.com'a
> aktarabilir miyiz? Önce buraya, sonra bir de portala kaydetmek zaman kaybı. Eklentiyle ya da exe ile."
> İşaretler: **[DOĞRULANDI]** birincil kaynakta okundu · **[İKİNCİL]** üçüncü taraf kaynakta okundu · **[DOĞRULANMADI]** kaynak bulunamadı
> veya sayfa erişilemedi (403) · **[KOD]** depoda dosya:satır ile doğrulandı.

---

## 0. Kısa cevap

- **Sahibinden'e resmî yoldan "EmlakSoft'tan ilan gönderme" bugün yok (CRM için).** Sahibinden'in kurumsal mağazalara açtığı resmî API
  **tek yönlü ve DIŞA doğru**: ofisin sahibinden'deki ilanlarını, şartları sağlayan başka bir firmaya taşır. Alan firma (1) ilancılık hizmeti
  vermeli, (2) Ticaret Bakanlığı EİDS'ye entegre olmalı, (3) sahibinden ile API Kullanım Sözleşmesi imzalamış olmalı. Bu yol bize **içe
  aktarma** (sahibinden → EmlakSoft) için uzun vadeli resmî bir kapı açar. Sahibinden'e **ilan yazma** yolu açmaz.
- **Hepsiemlak ve Emlakjet'e yazılım firması üzerinden yayın, sektörde fiilen var.** RE-OS ve Emlak Asistanım bu iki portala yayın,
  güncelleme ve kaldırma yaptığını söylüyor. RE-OS'un 2017 civarı duyurusuna göre bağlantı, Emlakjet panelindeki "Entegrasyon Anahtarı" ile
  kuruluyor. Teknik şema, başvuru ve ücret kamuya açık değil **[DOĞRULANMADI]**. Bu bir ortaklık başvurusu işi; sahip yürütür.
- **Hemen yapılabilecek ve sahibinden'i de kapsayan yol: eklentiyle yardımlı doldurma.** Kullanıcı portföy detayında "Portala aktar"a
  basar. Eklenti, kullanıcının kendi oturumunda portalın "İlan ver" formunu EmlakSoft verisi ve fotoğraflarla doldurur. **"Yayınla"ya
  kullanıcı basar.** Ardından ilan no ve URL EmlakSoft'a geri yazılır. Mevcut eklentinin manifest izinleri yeterli: yeni izin gerekmez (§6).
- **İçe aktarma** mevcut "İlanlarım/mağaza taraması" üzerine kurulur. Kullanıcı seçtiği ilanları portföy taslağı olarak alır; mükerrer
  kontrolünü mevcut `portal_listings` tekil kuralı ve `matching.ts` yapar.
- **Exe/RPA önerilmez:** imzasız exe SmartScreen engeline takılır, Windows'a bağlıdır, kırılgandır ve kullanım şartları riski taşır.
  Eklentiye göre ek bir kazancı yoktur.

---

## 1. Resmî yollar (internet araştırması)

### 1.1 Sahibinden.com

| Konu | Bulgu | Kaynak / durum |
|---|---|---|
| Kurumsal veri transferi | Kurumsal Emlak/Vasıta mağazalarına iki yöntem sunuluyor: **dosya oluşturarak transfer** ve **API ile transfer**. Emlak ofisi bunları "Ofisim" sayfasından kullanıyor. | Sahibinden yardım makalesi 19749005158172. Sayfa doğrudan 403 verdi; içerik arama özetinden okundu **[İKİNCİL]** |
| Yön | Ofisin sahibinden ilanları → **rakip/başka platform**. Ofis bir **erişim anahtarı** oluşturur ve anahtarı alan firmanın panelindeki mağaza ayarlarına yapıştırır. Alan firma bu anahtarla güncel ilan verisini sahibinden API'lerinden okur. | Emlakjet blogu (adım adım: "İlan Transferi" → "API ile Transfer Et" → "Erişim anahtarı oluştur" → firma = Emlakjet → SMS doğrulama) **[DOĞRULANDI]** |
| Alan firma şartları | "İlancılık hizmeti veren, Ticaret Bakanlığının oluşturduğu EIDS'ye entegre çalışan, sahibinden.com ile API Kullanımı sözleşmesi imzalamış" firma. Başvuru Ofisim'den yapılır, sahibinden değerlendirir ve sözleşmeyi gönderir. | Yardım makalesi (arama özeti) **[İKİNCİL]** |
| Ücret | Rekabet Kurulu, sahibinden'in API veri taşıma altyapısını kurduğunu ve erişimi **ücretsiz** sağladığını tespit etti. Karar 25-23/574-365, 26.06.2025; API 21.05.2025'te devreye alındı. Kurulun 17.08.2023 tarihli kararındaki taahhüdün uygulaması. | mfylegal.av.tr özeti **[İKİNCİL]**. Karar metnini okumadık **[DOĞRULANMADI]** |
| Senkron kapsamı | Sahibinden'deki güncellemeler (fiyat, açıklama, durum) alan portala yansıyor. Sahibinden'de **silme** yansımıyor. "Yeni ilanlar da aktarılsın: Evet/Hayır" seçeneği var. | Emlakjet blogu **[DOĞRULANDI]** |
| Sahibinden'e ilan YAZMA API'si (CRM için) | Bulunamadı. Bulunan "toplu ürün girişi / anlaşmalı entegratör" sayfaları Alışveriş (e-ticaret) kategorisi için ve ilan adedine göre ücretli. Emlak kategorisinde böyle bir yol görmedik. | yenitoptanci, ayensoftware (e-ticaret) **[İKİNCİL]**. Emlak için **[DOĞRULANMADI]** |
| "Sahibinden Pro" / mağaza paketleri | Kurumsal mağaza ürünleri var; ancak bir CRM'in sahibinden'e ilan basmasını sağlayan herkese açık bir ürün bulunamadı. Rapitek, "Sahibinden Pro"yu ayrı bir araç olarak anıyor. | **[DOĞRULANMADI]** |
| Kullanım koşulları (otomasyon) | Ek-1 Kullanım Koşulları ve Ek-7 Mağaza Kullanım Kuralları 403 verdi; madde metnini okuyamadık. Kullanıcı şikâyetlerinden sitenin olağandışı (otomatik) erişimi tespit edip bot doğrulamasına yönlendirdiği görülüyor. | sikayetvar **[İKİNCİL]**. Madde metni **[DOĞRULANMADI]** |

**Sonuç:** Bugün EmlakSoft sahibinden'e resmî yoldan ilan basamaz. Uzun vadede EmlakSoft "alan firma" olursa ofislerin sahibinden ilanlarını
**resmî ve ücretsiz** olarak içe alabilir. Bunun için EmlakSoft'un (a) "ilancılık hizmeti" sayılması gerekir; vitrin bunu karşılıyor mu,
**[DOĞRULANMADI]**. Ayrıca (b) EİDS Taşınmaz API entegrasyonu ve (c) sahibinden sözleşmesi gerekir. Bu bir **sahip başvurusu** konusudur (§9, S1).

### 1.2 Hepsiemlak

- Hepsiemlak'ın kendine ait, kamuya açık bir XML/API dokümanı bulunamadı **[DOĞRULANMADI]**. Kullanım koşulları sayfası 403 verdi.
- RE-OS: "Portföyünüzü RE-OS.com'da oluşturup, Hepsi Emlak üyeliğiniz üzerinde ilan olarak yayınlarsınız". İlan girişi, otomatik güncelleme
  ve yayından kaldırma yapılabiliyor. Şart: mevcut Hepsiemlak üyeliği **[İKİNCİL]**. Bir sayfada bu entegrasyonun "2027'ye kadar yalnız
  eXp Türkiye markası için" geçerli olduğu notu var **[İKİNCİL]**. Hepsiemlak'ın marka bazlı ve seçici ortaklık yaptığına işaret ediyor.
- Emlak Asistanım: Hepsiemlak ve Emlakjet'e yayın ve güncelleme yaptığını söylüyor **[İKİNCİL]**.
- Zingat 2023'te Hepsiemlak'ın çatı şirketine (Doğan Holding) satıldı. Rekabet Kurumu onayı bekleniyordu. Kasım 2023'te satın alma
  tamamlandı (CB Insights) **[İKİNCİL]**. Kapandığına dair kaynak yok. Ayrı bir entegrasyon hedefi olarak düşünülmemeli; koddaki
  `zingat` adaptörü (§3.2) kaldırma adayıdır.

### 1.3 Emlakjet

- Emlakjet, sahibinden API transferinin **alıcı** tarafında: "Otomatik İlan Transferi" ekranında sahibinden anahtarı giriliyor
  **[DOĞRULANDI]**. EİDS Taşınmaz API'ye entegre firmalar listesinde var **[İKİNCİL]**.
- RE-OS'un Emlakjet duyurusu (2017 civarı): "Emlakjet sayfanızda login olup Ayarlar menüsünden Entegrasyon Anahtarı başlığı seçilmelidir".
  Anahtar RE-OS'a giriliyor; yayın, güncelleme ve kaldırma tek tuşla yapılıyor **[İKİNCİL; eski, güncelliği DOĞRULANMADI]**.
  Yani Emlakjet'in **yazılım firmalarına açtığı, ofis anahtarlı bir yayın API'si** büyük olasılıkla var. Şema, başvuru ve ücret kamuya
  açık değil **[DOĞRULANMADI]**.
- Emlakjet veya Hepsiemlak'ın **ofis XML feed URL'si çektiğine** dair kaynak bulunamadı **[DOĞRULANMADI]**. Kodbizde gibi site
  üreticileri "XML/feed ile aktarım" diyor ama portal adı vermiyor.

### 1.4 Diğer portallar ve CRM'lerin yaptığı

| Firma | İddia | Mekanizma |
|---|---|---|
| RE-OS | HepsiEmlak, Emlakjet, Emlak24, HangiEv, Gaboras, Emlak Sitem, ListGlobally (yurt dışı) | Portal ortaklığı/anahtar. **Sahibinden YOK** (entegrasyon listesinde yer almıyor) **[İKİNCİL]** |
| Emlak Asistanım | Hepsiemlak, Emlakjet | Açıklanmamış **[İKİNCİL]** |
| EmlakCRMx | "Sahibinden, Hepsiemlak, Emlakjet ve Yenibiremlak'a tek panelden eş zamanlı yayın" | Mekanizma yok; resmî ortaklık iddiası yok **[İKİNCİL]** |
| Emlaksis (Suaresoft), Edge Bilişim, K-ONTECH | "Sahibinden, Hürriyet Emlak, Zingat... tek tık"; "API ve XML servisleri" | Pazarlama metni; Hürriyet Emlak adının geçmesi metnin eski olduğunu gösteriyor **[İKİNCİL]** |
| Rapitek | Kendini RE-OS / Sahibinden Pro / Emlak Asistanım üstünde çalışan CRM katmanı olarak konumluyor | Yayın yapmıyor **[İKİNCİL]** |

Sektör deseni şöyle: **Hepsiemlak ve Emlakjet'e resmî ortaklıkla yayın var. Sahibinden'e "yayın" iddia edenler mekanizma açıklamıyor.**
Ya sahibinden'den çekiyorlar (resmî transfer API'sinin alıcısı olarak), ya da tarayıcı otomasyonu kullanıyorlar **[çıkarım]**.
EmlakCRMx'in "4 portala elle yayın 65 dk → 8 dk" rakamı pazarlama iddiasıdır **[DOĞRULANMADI]**. Yine de kullanıcının "zaman kaybı"
şikâyetinin piyasadaki karşılığını gösteriyor.

Emlak365, Endeksa (ilan değil, değerleme verisi), Yenibiremlak: bu kaynaklarda entegrasyon bilgisi bulunamadı **[DOĞRULANMADI]**.
MVP'de yalnız sahibinden, hepsiemlak ve emlakjet ele alınır (mevcut adaptör kayıt defteriyle aynı).

### 1.5 EİDS'nin ilan yayınına etkisi

- **Dayanak:** Taşınmaz Ticareti Hakkında Yönetmelik değişikliği (31.08.2023). Kimlik doğrulaması 01.11.2023'te, yetki doğrulaması
  15.09.2024'te başladı. 15.09–31.12.2024 geçiş döneminden sonra, **01.01.2025'ten itibaren yetki doğrulaması olmayan ilan
  yayınlanamıyor**. Kaynak: Ticaret Bakanlığı İç Ticaret GM duyurusu **[DOĞRULANDI]**.
- **Kim ilan verebilir:** taşınmaz sahibi, eşi, 1. ve 2. derece kan hısımları ile sahibin e-Devlet'te yetkilendirdiği, **yetki belgeli**
  emlak işletmesi. "Yetki belgesi bulunmayan emlak işletmelerince ilan girişi yapılamayacaktır." **[DOĞRULANDI]**
- **Portal formunda zorunlu alan:** **taşınmaz numarası.** Ofis bu numarayı mal sahibinden alır. Yetkilendirmede ofisin **yetki belgesi
  numarası** girilir. **Yetki bitiş tarihi** en az 3 ay olmalı **[DOĞRULANDI]**.
- **Entegrasyon:** İlan platformları "EİDS Taşınmaz API"ye entegre olur. Bakanlık entegre firma listesini dönemsel olarak duyuruyor
  (Nisan/Ağustos/Eylül 2026). Liste bir Excel ekinde. Ocak 2026 kopyası Emlakjet, Hepsi Emlak, Sahibinden ile Remax, Century21
  Masterturk, Realty World gibi **franchise markalarını** da içeriyor; 54'ten fazla satır var **[İKİNCİL; Excel okunmadı]**.
  Çıkarım: kendi sitesinde ilan yayınlayan markalar da entegre oluyor. EmlakSoft vitrininin (ofis ilan sitesi) bu kapsamda olup olmadığı
  **[DOĞRULANMADI]**. Bu bir uyarı notudur, engel değildir (§7).
- **Sosyal medya:** Bakanlık, sosyal medyada paylaşılan ilanlarda "EİDS doğrulaması yapılmış ilan linki ile ilan fiyatı" bulunmasını
  bildirmiş **[İKİNCİL]**. Bu, portala aktarımdan geri yazılan **portal URL'sinin** paylaşım ve vitrin için de değerli olduğunu gösterir.
- **EmlakSoft'taki karşılığı [KOD]:** `properties.eids_property_no` (migration `20260826002950`, gevşek biçim
  `^[A-Z0-9-]{6,24}$`, `src/lib/eids/property-no.ts`), `authority_doc_no`, `authority_eids_status`, `authorization_end`
  (migration `20261008001300`, `20260723000034`) ve `authorityPublishWarning` (`src/lib/eids/authority-status.ts`, `portal-publish.ts`'te
  kullanılıyor). Yardımlı doldurma bu alanları **ilk adımda** gösterir. Numara yoksa uyarır ama aktarımı engellemez; portal zaten
  numarasız ilanı reddeder.

---

## 2. Eklenti ve exe yolları (teknik)

### 2.1 Eklentiyle form doldurma (dışa aktarma)

- **Mümkün:** Content script (veya `chrome.scripting.executeScript`), sayfadaki input, select ve textarea alanlarına değer yazar ve
  `input`/`change` olaylarını tetikler. React/Vue kontrollü alanlarda değer, yerel `HTMLInputElement.prototype.value` setter'ı ile yazılmalı
  ve ardından olay gönderilmeli. Aksi halde çerçeve değeri geri alır **[İKİNCİL: dev.to, pqina]**.
- **Fotoğraf:** `new DataTransfer()` ile `File` nesneleri oluşturulur, `input[type=file].files = dt.files` atanır ve `change` gönderilir.
  Bu yaygın bir desen; `multiple` input'ta önceki dosyalar korunarak eklenir **[İKİNCİL: pqina, greasyfork, Medium]**. Resmî Chrome
  dokümanı yok. Sınırlar:
  - Eklenti yerel diskteki dosyayı okuyamaz. Dosya **bellekten** gelmelidir (EmlakSoft'tan indirilen blob).
  - Bazı yükleyiciler yalnız drag-drop (`drop` olayı) dinler. Aynı `DataTransfer` ile sentetik `drop` olayı gönderilebilir, ama
    `isTrusted=false` olduğu için reddedilebilir **[DOĞRULANMADI: portal bazında test şart]**.
  - Fotoğraf sayısı, boyut ve oran sınırları portal formunda okunmalı; sahibinden için kaynak bulunamadı **[DOĞRULANMADI]**.
    Tasarım bu yüzden sınırları **sabit kodlamaz**: `portal-rules.json` benzeri bir kural dosyasından (`maxPhotos`, `maxBytes`) okur ve
    fazlasını sıralamaya göre (kapak önce, `sort_order`) keser.
  - **Engelleme riski:** Portal yükleyicisi `isTrusted` kontrol edebilir, CAPTCHA çıkabilir ya da form değişebilir. Bu durumda dürüst
    geri dönüş yapılır: "Fotoğrafları otomatik ekleyemedik. Fotoğraflar indirildi (zip) veya panoda; sürükleyip bırakın." Bilgi alanları
    yine doldurulmuş olur.
- **Kategori adımları:** Sahibinden'de ilan verme çok adımlı bir sihirbazdır (Emlak → Konut → Satılık → Daire → form). Eklenti her adımda
  **yalnız seçim önerir veya yapar** ve kullanıcı ilerler. Tam otomatik çok adımlı gezinme kırılganlığı ve şart riskini artırır; MVP'de
  yapılmaz. Kategori ağacı ve alan adları canlı formda doğrulanmadı **[DOĞRULANMADI]**.
- **Geri yazma:** Yayından sonra portalın "ilanınız yayında / ilan no" sayfası veya kullanıcının açtığı ilan sayfası okunur.
  `listingNo` desenleri `portal-rules.json`'da zaten var. Okunamazsa kullanıcı ilan no/URL'yi yapıştırır (mevcut manuel bağlama yolu).
- **Kullanım şartları açısından ayrım:**
  - (a) **Kullanıcı tetikli, kullanıcı oturumunda doldurma + "Yayınla"ya kullanıcının basması.** Davranış olarak bir şifre yöneticisinin
    otomatik doldurmasına ve kopyala-yapıştıra yakındır: hız sınırı aşılmaz, erişim kontrolü atlatılmaz, kazıma yapılmaz. Risk düşük ama
    sıfır değil. Madde metni okunamadı **[DOĞRULANMADI]**.
  - (b) **Tam otomatik yayın** (arka planda toplu ilan basma, zamanlanmış yayın, CAPTCHA aşma). Bot sayılma ve hesap askısı riski
    yüksektir; ayrıca mevcut adaptör ilkesine aykırıdır (`adapters/types.ts`: CAPTCHA atlatma ve rate-limit bypass yasak). **Yapılmaz.**
  - Chrome Web Store: "Kullanıcıya içeriği ve alıcıyı onaylatmadan kullanıcı adına mesaj gönderen eklentilere izin verilmez" maddesi var
    **[DOĞRULANDI]**. İlan yayını mesaj değildir, ama aynı ruhla **son gönderim kullanıcıda** kalmalıdır.

### 2.2 Eklentiyle içe aktarma

- Mevcut mağaza taraması, ofisin kendi "İlanlarım" listesini sayfalı okuyor (`worker/extension-scan.ts`, `storeStartUrls`
  `https://banaozel.sahibinden.com/ilanlarim`). Desenler sentetik örneklere göre yazılmış ve gerçek portalda doğrulanmamış:
  `portal-rules.json` `"verified": false` **[KOD]**.
- Liste kartından yalnız id, url, başlık, fiyat, durum (ve varsa m², oda, konum) okunuyor (`InventoryRow`). Portföy taslağı için daha
  fazla alan gerekiyor (tip, kat, ısıtma, açıklama). Bunlar için **seçilen** her ilanın detay sayfası, kullanıcının tıklamasıyla ve mevcut
  hız kuralıyla (`extension-pacing.ts`) okunur.
- Fotoğraf içe aktarma: portal görselleri çoğu zaman portal filigranlıdır ve CDN'den gelir. MVP'de **kapalı**; isteğe bağlı v2.
  Ofisin zaten kendi fotoğrafları var.

### 2.3 Exe / masaüstü RPA

| Risk | Ayrıntı |
|---|---|
| SmartScreen | İmzasız ikili dosyalar "Windows bilgisayarınızı korudu" uyarısıyla güçlü biçimde engellenir. Ağustos 2024'ten beri EV sertifikanın anında itibar avantajı kalktı, itibar dosya özetine göre birikiyor. Her yeni sürüm yeniden uyarı alabilir **[İKİNCİL: todesktop, Gantner, Microsoft Q&A]**. OV/EV sertifika yıllık ücretlidir ve şirket doğrulaması ister. |
| Platform | Yalnız Windows; Mac'te ve mobilde yok. Kurulum ve güncelleme dağıtımı ayrı bir iş. |
| Kırılganlık | Ekran/DOM otomasyonu portal değişince kırılır; eklentiden daha kötüdür, çünkü uzaktan kural güncellemesi de zor. |
| Güvenlik / güven | Kullanıcının tarayıcı çerezlerine veya şifresine erişim izlenimi verir. Kurumsal antivirüsler RPA araçlarını işaretler. |
| Şartlar | Ayrı bir tarayıcı profiliyle "headless" çalışan RPA, portal açısından bot imzasıdır (CAPTCHA, IP kontrolü). |
| Kazanç | Eklentinin yapamayıp exe'nin yapabildiği tek şey yerel dosya okumaktır; bize gerekmiyor, fotoğraflar zaten bulutta. |

**Karar: exe yapılmaz.** Eklenti zaten Chrome/Edge'de yayımlanmış ve kurulu (0.4.0); aynı paket genişletilir.

---

## 3. Mevcut kod (salt okunur inceleme)

### 3.1 Var olanlar [KOD]

| Parça | Yer | Not |
|---|---|---|
| Portal ilan kaydı | `portal_listings` (init `20260721000000:162`) + zincir kolonları (`20260826002000`): `supersedes_id`, `source_kind` ∈ {manual, api, feed, csv, **assisted**}, `created_via` ∈ {manual, bind, rotate, **import**, api, matching}, `external_id_norm` (üretilmiş), canlı tekil indeks `uq_portal_listings_live_external` (tenant, portal, ilan no) | **İstenen `property_portal_links` zaten bu tablodur.** Yeni tablo açmak mükerrer olur. Yazma yalnız service_role RPC ile (`guard_portal_listing_atomic_mutation`). |
| Bağlama RPC'si | `lc_bind_portal_listing(tenant, actor, property, portal, ilan_no, url, source_kind, created_via)` → applied / replay / bound_to_other_property | Dışa aktarmanın geri yazması ve içe aktarmanın bağlaması **aynı RPC** ile yapılır. |
| Sık değişen kontrol alanları | `portal_listing_health` (1:1, `20260826002020`): portal fiyatı, son görülme | Karşılaştırma (fiyat farkı) buradan beslenir. |
| Portal sayfaları | `/app/portallar` (teyit, kapanış), `/app/ilan-kontrol` (İlan Kontrol), portföy detayı `?sekme=portallar` (`PROPERTY_TAB_IDS`, `portfoyler/[id]/page.tsx:144`) | Menü yerleşimi hazır: "Portföyler" merkezinde Portallar ve İlan kontrolü sekmeleri var (`nav-roles.ts:88-94`). |
| API yayın iskeleti | `src/lib/integrations/portals/index.ts` + `actions/portal-publish.ts` + `portal-listing-actions.tsx` | Uç noktalar (`api.sahibinden.com/listings`, `api.hepsiemlak.com/adverts`, `api.zingat.com`, `api.emlakjet.com/ilan`) ve alan adları **tahmin**. Hiçbir portalın dokümanına dayanmıyor. `baseUrl` + anahtar yoksa kapalı kalıyor (güvenli). Öneri: dosya başına "SÖZLEŞME YOKSA KAPALI, UÇLAR TAHMİNDİR" notu kalsın, zingat çıkarılsın, gerçek ortaklık gelince yeniden yazılsın. |
| Okuma adaptörleri | `src/lib/listing-control/adapters/*` (sahibinden/hepsiemlak/emlakjet iskelet + HTML ayrıştırıcı + `portal-rules.json`) | `capabilities.api/feed` hepsi kapalı. `allPortalHosts()` manifest host'larının tek kaynağı. |
| Envanter karşılaştırma | `inventory-import.ts` (SAF): eşleşen, kaldırılmış, CRM'de kayıtsız, fiyat farkı, farklı danışman... `bulk-mismatch.ts`, `matching.ts` (`rankCandidates`) | KARŞILAŞTIRMA zaten büyük ölçüde var; eksik olan "portal ilanından portföy oluştur" adımı. |
| Eklenti | `extensions/emlaksoft-ilan-kontrol` 0.4.0. İzinler `storage, alarms, activeTab, scripting`. Derlenmiş `host_permissions`: `https://*.sahibinden.com/*`, `*.hepsiemlak.com`, `*.emlakjet.com`. Content script yalnız EmlakSoft kökeninde; `externally_connectable` yalnız EmlakSoft | Portal sayfasına `scripting.executeScript` ile betik enjekte etmek için **izin zaten var**. |
| Tek ilan kaydı deseni | FSBO: popup → `captureSnapshot` → kullanıcı düzenler/onaylar → kuyruk → EmlakSoft sekmesi `POST /api/app/portfoy-avi/kaydet` (aynı köken + özel başlık, `parsePhoneStrict`) | İçe aktarma aynı köprü desenini kullanır. |
| Genel içe aktarma | `actions/import-data.ts` + `lib/import-rows.ts` (`propertyKey` = başlık\|adres katlanmış; `DuplicatePolicy`) + `/app/ice-aktarma` sihirbazı | Dosya tabanlı; portal içe aktarması için mükerrer anahtarı ilan no olmalı (ayrı yol, §4.2). |
| Fotoğraf | `property_media` (kind image/video/tour, `storage_path`, `is_cover`, `sort_order`), filigran ayarı `/app/ayarlar/filigran` | Dışa aktarma fotoğrafları ofis filigranıyla verebilir. |

### 3.2 Portföy veri modelinde eksik portal alanları [KOD]

`properties` sütunları: `property_code, title, transaction_type, property_type, status, list_price, min_price, province_id, district_id,
neighborhood_id, address_line, lat/lng, parcel_block, parcel_lot, swap_ok, eids_property_no, authority_*, authorization_end,
foreign_eligible, features jsonb`. Formun yazdığı `features` anahtarları (`actions/properties.ts:103 parseFeatureFields`): `rooms, sqm, floor,
heating, building_age, facade`, ayrıca `description` (`lib/property-description.ts`) ve `virtual_tour_url`.

**Portal formlarının sık istediği ama EmlakSoft'ta olmayanlar:** brüt/net m² ayrımı, kat sayısı, banyo sayısı, balkon, asansör, otopark,
eşya durumu, kullanım durumu (boş/kiracılı/mülk sahibi), site içi ve site adı, aidat, krediye uygunluk, tapu durumu, para birimi.
Bunlar boş kalırsa form yarım dolar ve kullanıcı yine elle tamamlar. Bu da kazancı azaltır.

---

## 4. Rapor

### 4(a) Yol karşılaştırması ve öneri

| Ölçüt | Resmî API / feed | Eklentiyle yardımlı doldurma | Exe / RPA |
|---|---|---|---|
| Sahibinden'e yayın | **Yok** (CRM için) | **Var** (kullanıcı yayınlar) | Teknik olarak var, önerilmez |
| Hepsiemlak / Emlakjet yayını | Büyük olasılıkla ortaklıkla var (RE-OS örneği); şema ve başvuru **[DOĞRULANMADI]** | Var | Var |
| Sahibinden'den içe aktarma | Resmî transfer API'si: EmlakSoft "alan firma" olursa ücretsiz, tam ve sürekli senkron. Şart: ilancılık + EİDS entegrasyonu + sözleşme | İlanlarım + detay okuma (kullanıcı tetikli) | Var, önerilmez |
| Hazır olma süresi | Aylar (başvuru, sözleşme, EİDS entegrasyonu) | Haftalar (eklenti zaten kurulu) | Haftalar + sertifika |
| Güvenilirlik | Yüksek (sözleşmeli şema) | Orta (portal DOM değişir; kural JSON'u ile yamalanır) | Düşük |
| Şart / hesap riski | Yok | Düşük (kullanıcı eylemi, oturumu, hızı) | Orta-yüksek |
| Kullanıcı eforu | Sıfır (otomatik) | Düşük: "Aktar" → kontrol et → "Yayınla" | Kurulum zahmetli, SmartScreen |
| Maliyet | Ortaklık / ücret **[DOĞRULANMADI]**; sahibinden transferi ücretsiz | Geliştirme | Geliştirme + yıllık sertifika |
| Platform | Her yerde (sunucu) | Masaüstü Chrome/Edge | Yalnız Windows |

**Öneri (iki hat birlikte):**
1. **Hemen (MVP):** eklentiyle yardımlı doldurma (dışa aktarma), seçili içe aktarma ve birleşik karşılaştırma. Sahibinden dahil üç
   portalda çalışır.
2. **Paralel (sahip işi):** (S1) sahibinden "alan firma" başvurusu ve EİDS Taşınmaz API entegrasyonu araştırması; (S2) Emlakjet ve
   Hepsiemlak yazılım ortaklığı başvurusu (şema, ücret, anahtar akışı). Resmî yol açıldıkça ilgili portal için eklenti adımı **otomatik
   senkron** ile değiştirilir (`source_kind='api'`). Ekranlar ve veri modeli aynı kalır.
3. **Yapılmaz:** exe/RPA, tam otomatik/zamanlanmış toplu yayın, sunucudan portal kazıma.

### 4(b) MVP kapsamı

**DIŞA AKTARMA: "Portala aktar"**
1. Portföy detayı → `?sekme=portallar` → portal kartında "Sahibinden'e aktar" (Hepsiemlak ve Emlakjet de aynı). Sayfada indirme düğmesi
   yok; bu bir dosya çıktısı değil, kural ihlali yok.
2. **Hazırlık kontrolü (sunucu, saf fonksiyon):** zorunlu alan listesi (portal kuralından) ile portföy karşılaştırılır. Örnek uyarılar:
   "Eksik: banyo sayısı, aidat, EİDS taşınmaz no" ve "Yetki: onay bekleniyor" (`authorityPublishWarning`). **Engellemez**; eksikleri o
   anda doldurmak için satır içi alanlar sunar ve bunları `features`'a yazar.
3. **Aktarım paketi:** sunucu, `buildPortalPayload(property, portal)` ile form değerlerini (portalın seçenek metinlerine eşlenmiş) ve
   fotoğraf listesini üretir. Fotoğraflar kısa ömürlü imzalı ve filigranlı URL'lerdir. Paket `portal_transfer_sessions`'a kaydedilir
   (§4e) ve tek kullanımlık bir `session_id` döner.
4. **Köprü:** EmlakSoft sayfası → content script → arka plan. Arka plan portalın "İlan ver" adresini yeni sekmede açar. Kullanıcı
   kategori adımlarını eklentinin vurguladığı seçeneklerle geçer.
5. **Doldurma:** kullanıcı forma gelince eklenti paneli "Formu doldur"u gösterir. `scripting.executeScript` alanları yazar; fotoğraflar
   `DataTransfer` ile eklenir (§2.1). Panel her alan için sonuç gösterir: dolduruldu / bulunamadı / seçenek eşleşmedi.
6. **Yayın:** "Yayınla"ya **kullanıcı** basar. Eklenti gönderim yapmaz.
7. **Geri yazma:** onay sayfasında veya kullanıcının açtığı ilan sayfasında ilan no ve URL okunur. Kuyruk → EmlakSoft sekmesi → yeni
   bir uç (`POST /api/app/portal-aktar/tamamla`) → `lc_bind_portal_listing(..., source_kind='assisted', created_via='bind')`.
   `bound_to_other_property` çıkarsa kullanıcıya gösterilir. Okunamazsa "İlan no/URL yapıştır" (mevcut manuel bağlama).
8. **Sonuç:** portföyün Portallar sekmesinde "Sahibinden · yayında · ilan no · bugün" kartı görünür ve İlan Kontrol teyit döngüsüne girer.

**İÇE AKTARMA: "Portaldaki ilanlarımı al"**
1. `/app/portallar` → "Portaldan al" (veya eklenti popup'ında "İlanlarımı EmlakSoft'a al"). Eklenti son mağaza taramasını kullanır;
   yoksa kullanıcı tetikli yeni bir tarama başlatır.
2. Liste ekranı her satıra bir etiket koyar:
   - **Zaten bağlı:** `external_id_norm` canlı satırda var. Atlanır.
   - **Olası eşleşme:** `rankCandidates` puanı ≥ 60 ise "şu portföyle bağla" önerilir.
   - **Yeni:** hiçbir eşleşme yok.
3. Kullanıcı satırları seçer. "Yeni" satırlar için eklenti detay sayfasını hız kuralıyla okur ve sunucu **taslak portföy** oluşturur
   (`status='draft'`, `is_sample=false`). Ardından `lc_bind_portal_listing(..., created_via='import', source_kind='assisted')` çağrılır.
   "Olası eşleşme" satırları yalnız bağlanır; yeni portföy açılmaz.
4. Telefon ve kişisel veri alınmaz. Fiyat, başlık, oda, m², konum, açıklama alınır. Konum `resolveDistrict` (FSBO'daki) ile il/ilçe
   kimliğine çevrilir.
5. Mükerrer kontrolü **iki katmanlıdır**: ilan no (kesin, DB tekil indeksi) ve `matching.ts` (bulanık). `import-rows.ts` başlık|adres
   anahtarı yalnız üçüncü bir güvenlik ağı olarak kullanılır.

**KARŞILAŞTIRMA: tek ekran (yeni sayfa yok)**
- Mevcut `/app/ilan-kontrol` ve `inventory-import.ts` kırılımları korunur. Eklenecek tek kavram **"eksik portal"dır**: ofisin
  "yayınlanacak portallar" ayarına göre, aktif portföyün hangi portalda ilanı yok. Kart → filtreli liste → satırda "Portala aktar".
  Sıfır çıkmaz metrik kuralına uyar.
- Farklar portal≠EmlakSoft olarak gösterilir: fiyat (`portal_listing_health` ile `list_price`, tolerans %1), durum (portalda pasif veya
  kaldırılmış, EmlakSoft'ta aktif; ya da tersi), danışman farkı ve eksik portal. Her farkın yanında tek eylem bulunur: "Portalda
  güncelle (aktar)" ya da "EmlakSoft'u güncelle".
- **Fiyat güncelleme aktarımı:** dışa aktarma akışının "düzenle" kipidir. Portalın ilan düzenleme sayfası açılır ve yalnız fiyat ile
  değişen alanlar doldurulur.

**RESMÎ FEED (koşullu, MVP'de kapalı):** Bir portal ofis XML feed URL'si kabul ettiğini **yazılı olarak teyit ederse** ofis başına
token'lı feed yayımlanır: `/api/feed/portal/[portal]/[token].xml`. Kurallar:
- Token karması DB'de, yenileme ve iptal ayarlardan yapılır.
- `noindex`, sitemap'e ASLA girmez.
- Yalnız ofisin "bu portalda yayınla" işaretli aktif portföyleri; `is_sample` hariç.
- Fotoğraflar imzasız ama filigranlı public kopya **ya da** kısa ömürlü imzalı URL. Hangisi olacağı portalın şemasına bağlı.
- Şema portal belgesi gelmeden **uydurulmaz**.

### 4(c) Alan eşleme tablosu

> Portal sütunlarındaki etiketler, ilan **detay sayfalarında** herkese açık görünen başlıklardan ve genel bilgiden derlendi. "İlan ver"
> formunun tam alan adları, zorunluluk durumu ve seçenek listesi **canlı formda DOĞRULANMADI**. Uygulamada her portal için
> `portal-rules.json` benzeri bir **form kuralı dosyası** (seçici + seçenek eşleme + `verified` bayrağı) hazırlanır ve gerçek hesapta
> doğrulanır.

| EmlakSoft (kaynak) | Sahibinden (konut) | Hepsiemlak | Emlakjet | Not |
|---|---|---|---|---|
| `transaction_type` (satilik/kiralik) | Kategori adımı: Satılık / Kiralık | İlan tipi | İlan tipi | Kategori seçimi kullanıcıyla birlikte yapılır |
| `property_type` (daire, villa, arsa...) | Kategori: Konut → Daire/Rezidans/Villa..., Arsa, İşyeri | Emlak tipi | Emlak tipi | Eşleme tablosu kodda tutulur; tutmazsa sorulur |
| `title` | İlan başlığı | Başlık | Başlık | Portal karakter sınırı **[DOĞRULANMADI]**: kural dosyasında |
| `features.description` | Açıklama | Açıklama | Açıklama | HTML/biçim desteği farklı; düz metin + satır sonu |
| `list_price` | Fiyat | Fiyat | Fiyat | — |
| (yok) para birimi | TL / USD / EUR | aynı | aynı | **Eksik** → varsayılan TL; `features.currency` önerilir |
| `province_id/district_id/neighborhood_id` | İl / İlçe / Mahalle | aynı | aynı | Ad eşlemesi; mahalle adı farkı olası. Tutmazsa kullanıcı seçer |
| `lat/lng` | Harita pin | Harita | Harita | Harita bileşenine yazmak güvenilmez → MVP'de kullanıcı |
| `features.sqm` | m² (Brüt) **ve** m² (Net) | Brüt / Net m² | Brüt / Net m² | **Eksik ayrım** → `features.gross_sqm`, `features.net_sqm` (`sqm` = brüt kabul) |
| `features.rooms` | Oda Sayısı (örn. 3+1) | Oda + Salon | Oda Sayısı | Biçim normalizasyonu |
| `features.building_age` | Bina Yaşı | Bina Yaşı | Bina Yaşı | Portal aralık seçeneği olabilir (0, 1, 2..., 21-25) |
| `features.floor` | Bulunduğu Kat (Giriş, Bahçe, Yüksek giriş, 1...) | Bulunduğu Kat | Bulunduğu Kat | Metin↔sayı eşlemesi |
| (yok) kat sayısı | Kat Sayısı | Kat Sayısı | Kat Sayısı | **Eksik** → `features.total_floors` |
| `features.heating` | Isıtma (Kombi doğalgaz, Merkezi...) | Isıtma | Isıtma | Seçenek eşleme |
| (yok) banyo | Banyo Sayısı | Banyo | Banyo | **Eksik** → `features.bathrooms` |
| (yok) balkon / asansör / otopark | Balkon, Asansör, Otopark | benzer | benzer | **Eksik** → `features.balcony/elevator/parking` |
| (yok) eşyalı | Eşyalı | Eşya Durumu | Eşya Durumu | **Eksik** → `features.furnished` |
| (yok) kullanım durumu | Kullanım Durumu (Boş / Kiracılı / Mülk sahibi) | benzer | benzer | **Eksik** → `features.usage_status` |
| (yok) site | Site İçerisinde, Site Adı | Site içi | Site içi | **Eksik** → `features.in_site`, `features.site_name` |
| (yok) aidat | Aidat (TL) | Aidat | Aidat | **Eksik** → `features.dues` |
| (yok) kredi | Krediye Uygun | Krediye uygun | Krediye uygun | **Eksik** → `features.credit_eligible` |
| (yok) tapu durumu | Tapu Durumu (Kat mülkiyetli / Kat irtifaklı / Hisseli...) | Tapu durumu | Tapu durumu | **Eksik** → `features.deed_status` |
| `swap_ok` | Takas | Takas | Takas | Var |
| `features.facade` | Cephe (bazı kategorilerde) | Cephe | Cephe | Var |
| `eids_property_no` | **Taşınmaz numarası** (EİDS, zorunlu) | aynı | aynı | Zorunlu **[DOĞRULANDI: Bakanlık]**; form alan adı **[DOĞRULANMADI]** |
| `authority_doc_no` / ofis yetki belgesi no | Ofis profilinde (mağaza) | Ofis profili | Ofis profili | İlan başına mı, hesap başına mı **[DOĞRULANMADI]** |
| `authorization_end` | (EİDS yetki bitişi; formda değil, EİDS'de) | — | — | Bilgi amaçlı uyarı: yetki bitişi 3 aydan kısaysa |
| `property_media` (image, `sort_order`, `is_cover`) | Fotoğraflar (sayı ve boyut sınırı **[DOĞRULANMADI]**) | Fotoğraf | Fotoğraf | Kapak ilk; filigran ayarı uygulanır |
| `features.virtual_tour_url` | Video / sanal tur (varsa) | Video | Video | Portal desteği **[DOĞRULANMADI]** |
| `parcel_block/parcel_lot` | Ada / Parsel (arsa kategorisinde) | Ada/Parsel | Ada/Parsel | Arsa için |
| `property_code` | (portalda yok) → ofis içi not / referans alanı varsa | Referans no? | Referans no? | **[DOĞRULANMADI]**: varsa eşleşmeyi kolaylaştırır |
| Kimden | "Emlak Ofisinden" (hesap türünden gelir) | — | — | Hesap türü |

**İçe aktarma ters eşlemesi** aynı tablodan üretilir. Okunamayan alan boş kalır; tahmin yazılmaz.

### 4(d) Eklenti izin etkisi

| İhtiyaç | Gereken | Mevcut durum | Sonuç |
|---|---|---|---|
| Portal sekmesine betik enjekte etme (doldurma, okuma) | `scripting` + portal host izni (ya da kullanıcı tıklamasıyla `activeTab`) | `scripting` ve `activeTab` var; `host_permissions` üç portalı içeriyor (build) | **Yeni izin yok** |
| Portalın "İlan ver" sekmesini açma | `chrome.tabs.create` (izinsiz) | — | Yeni izin yok |
| Aktarım paketini EmlakSoft'tan alma | Content script (EmlakSoft kökeni) → arka plan iletisi | Var (köprü) | Yeni izin yok |
| Fotoğraf baytları | Fotoğraflar Supabase Storage host'unda. Arka planın o host'a `fetch`'i ya yeni host izni ister ya da CORS'a bağlıdır **[DOĞRULANMADI]** | Yok | **Öneri:** yeni izin istemeden, EmlakSoft'ta aynı kökenli vekil uç `/api/app/portal-aktar/medya/[session]/[i]` (oturum + tenant + tek kullanımlık oturum doğrulaması, filigran uygulanmış). Content script aynı kökenden indirir ve parçalar halinde arka plana iletir (`chrome.runtime` ileti sınırı ~64 MiB; 20 × ~500 KB rahat sığar) **[sınır DOĞRULANMADI]**. Alternatif: `optional_host_permissions` ile çalışma anında istemek; mevcut kurulumları devre dışı bırakmaz. |
| İlan no okuma (onay sayfası) | Aynı enjeksiyon | Var | Yeni izin yok |
| `downloads` (fotoğraf zip geri dönüşü) | Gerekmez: zip EmlakSoft sayfasında üretilir. Bu bir dosya çıktısıdır; "Rapor merkezi" kuralıyla çakışmaması için gerekçeli istisna gerekir. | — | Rapor merkezi istisnası olarak işaretlenmeli **veya** pano/sürükle-bırak yönlendirmesiyle yetinilmeli (tercih) |

- **Yeni zorunlu izin eklenmediği sürece** Chrome mevcut kurulumları "yeni izin onayı" için devre dışı bırakmaz.
- **Chrome Web Store tek amaç açıklaması güncellenmeli.** Mevcut açıklama: "İlanlarınızı tarayıcınızda portföyünüzle karşılaştırır;
  sahibinden ilanları tek tıkla EmlakSoft'a kaydeder." Mağaza kuralı: "tek ve dar, kolay anlaşılır amaç" **[DOĞRULANDI]**. Önerilen
  ortak amaç: **"EmlakSoft portföyünüz ile ilan portallarındaki kendi ilanlarınızı eşitler: karşılaştırır, portal formunu sizin onayınızla
  doldurur, ilanlarınızı EmlakSoft'a alır."** (132 karakter sınırı kontrol edilmeli.) Gizlilik politikasındaki eklenti bölümüne
  (`81907bab`) şu eklenmeli: "portföy verisi ve fotoğrafları yalnız siz 'Portala aktar' dediğinizde, açtığınız portal sekmesine
  yazılır; ilan no ve URL EmlakSoft'a döner." Limited Use kuralı: veri yalnız bu amaçla kullanılır.
- Mağaza "izin gerekçesi" metninde `scripting` için yeni kullanım ("kullanıcı tıklamasıyla portal formunu doldurma") eklenmeli.
  İnceleme yeniden yapılır; mağaza hesabı ve gönderim sahibin işidir.
- MV3 uzak kod yasağı: form kural dosyası **yalnız veri** (seçici + eşleme JSON) olabilir; çalıştırılabilir kod uzaktan gelmez (mevcut
  ilke).

### 4(e) Veri modeli ve migration planı

**İlke:** `property_portal_links` AÇILMAZ; `portal_listings` (+ `portal_listing_health`) zaten bu işi yapıyor (§3.1). Yeni kolonlar
forward-only olur, `migration-yazici` ajanıyla yazılır ve canlıya yalnız sahip onayı ve yedekten sonra uygulanır.

1. **`portal_transfer_sessions`** (yeni tablo; `tenant_id` + RLS + tenant indeksi):
   `id, tenant_id, property_id, portal text, direction ('export'|'import'|'update'), state ('prepared'|'filled'|'published'|'failed'|'abandoned'),
   payload_hash text, field_report jsonb (alan başına dolduruldu/bulunamadı), missing_fields text[], portal_listing_id uuid null (FK,
   tenant bileşik), actor_id, created_at, completed_at, expires_at (örn. +2 saat)`.
   Amaç: tek kullanımlık aktarım paketi, fotoğraf vekil ucunun yetki kaynağı, "yarım kalan aktarım" ve başarı ölçümü (alan doldurma
   oranı, portal bazında kırılma telemetrisi; `lc_parser_telemetry` deseni). Payload'ın kendisi saklanmaz, yalnız karması saklanır;
   kişisel veri yoktur. Yazma service_role RPC ile; okuma RLS ile `portals` modülü yetkisi.
2. **`portal_listings.created_via` CHECK'ine `'export'` eklemek** (isteğe bağlı): ölçüm netliği için. Alternatif olarak migration'sız
   `created_via='bind'` + `source_kind='assisted'` + oturum FK'si yeterli. Öneri: **migration'sız başla.**
3. **Ofis portal tercihi:** "Bu ofis hangi portallarda yayınlar" (eksik portal metriği için) `tenant_settings` jsonb'de (mevcut ayar
   deseni) tutulabilir; migration gerekmez. Yoksa tek kolonlu ayar migration'ı yazılır.
4. **Eksik portal alanları:** `properties.features` jsonb anahtarları (`gross_sqm, net_sqm, total_floors, bathrooms, balcony, elevator,
   parking, furnished, usage_status, in_site, site_name, dues, credit_eligible, deed_status, currency`). **Migration gerekmez**; form
   ve `parseFeatureFields` genişletilir. Eşleştirme ve emsal sorgusu gerektiren alanlar ileride kolona taşınabilir.
5. **Resmî feed (koşullu):** `portal_feed_tokens(tenant_id, portal, token_hash, created_at, revoked_at, last_fetched_at)`. Yalnız bir portal
   kabul ederse yazılır.
6. **Yetki:** mevcut `portals` modülü (`permissions.ts`). Aktarma `portals:edit`, içe aktarma `properties:create` + `portals:edit`.
   Yeni modül yok, dolayısıyla 4 kayıt yeri değişmez.

### 4(f) Menü yerleşimi

- **Yeni menü satırı yok.** (Menü ilkesi ve nav-budget-contract.)
- Dışa aktarma: **portföy detayı → Portallar sekmesi** (`?sekme=portallar`, mevcut). Portal başına kart: "Aktar" / "Yayında · ilan no ·
  teyit" / "Fiyat farkı → Güncelle". Mobilde düğme gizlenir; yerine "Masaüstü tarayıcıda eklentiyle aktarılır" bilgisi çıkar
  (eklenti mobilde çalışmaz).
- İçe aktarma ve karşılaştırma: **Portföyler merkezi → "Portallar" sekmesi** (`/app/portallar`, mevcut) başlığında "Portaldan al".
  "Eksik portal" ve fark kartları **İlan kontrolü** sekmesinde (`/app/ilan-kontrol`), filtreli hedeflere gider.
- Portföy listesinde toplu seçim → "Portala aktar" (v2). Sırayla tek tek açar; yayın her ilanda yine kullanıcıdadır.

### 4(g) Hukuk ve risk uyarıları (engellemez, uyarır)

- **Portal kullanım şartları:** sahibinden ve hepsiemlak koşul metinleri okunamadı (403) **[DOĞRULANMADI]**. Tasarım riski azaltır:
  kullanıcının kendi oturumu, kendi ilanı, kendi tıklaması, düşük hız; CAPTCHA çıkarsa durur; toplu/zamanlanmış yayın yok. Ürün metni
  önerisi: "Aktarım sizin hesabınızda ve sizin onayınızla yapılır. Portal bir değişiklik yaparsa form doldurma geçici olarak
  çalışmayabilir."
- **EİDS:** taşınmaz numarası ve yetki olmadan portal ilanı reddeder. EmlakSoft yalnız uyarır ("EİDS no eksik", "yetki bitişi 3 aydan
  kısa"). Bu kontrol **resmî sorgu değildir** (`property-no.ts` notu).
- **Vitrin ve EİDS kapsamı:** franchise markaları entegre listede yer alıyor. Ofisin EmlakSoft vitrininde ilan yayınlamasının "elektronik
  ilan" sayılıp sayılmadığı **[DOĞRULANMADI]**. Bu bilgi için hukuk görüşü alınmalı; iş bekletilmez. Ara çözüm: vitrin ilan kartında
  geri yazılmış EİDS doğrulamalı portal bağlantısı gösterilir (sosyal medya kuralıyla da uyumlu).
- **KVKK:** içe aktarmada telefon ve kişi adı alınmaz. Dışa aktarmada ofisin iletişim bilgisi portal hesabından gelir, EmlakSoft yazmaz.
- **Fotoğraf hakları:** portaldan içe aktarılan görseller (v2) portal filigranlı olabilir; varsayılan kapalı.
- **Rekabet hukuku notu:** sahibinden'in transfer API'si Rekabet Kurulu yükümlülüğüdür. Başvuru reddedilirse bu, sahip için bir
  itiraz zemini olabilir (bilgi, hukuki görüş değil).
- **Kırılganlık:** portal DOM değişikliği beklenen bir olaydır. Form kural dosyası, telemetri ve dürüst "dolduramadık" durumu birlikte
  çalışır. Gerçek portalda doğrulanmadan "otomatik" diye pazarlanmaz.

### 4(h) Uygulama adımları (öncelik sırasıyla)

**Sahip işleri (paralel, kod dışı):**
- S1. Sahibinden: Ofisim → İlan Aktarımı → "API ile Veri Transfer" alan firma başvurusu için şartları sor. EmlakSoft'un "ilancılık hizmeti"
  sayılıp sayılmadığını ve EİDS Taşınmaz API entegrasyonu gerekip gerekmediğini netleştir. Ücretsiz olduğu Rekabet Kurulu kararında geçiyor.
- S2. Emlakjet ve Hepsiemlak: yazılım ortaklığı başvurusu. Şema (XML mi, REST mi), anahtar akışı, ücret, marka kısıtı.
- S3. Ticaret Bakanlığı EİDS entegre firma listesinin (Excel) güncel sürümünü indir; vitrin kapsamı için hukuk görüşü al.
- S4. Gerçek sahibinden, hepsiemlak ve emlakjet ofis hesabında form ve İlanlarım doğrulaması. Test hesabı ve ekran kaydı sahipten
  gelir; mevcut `portal-rules.json` de `verified: false`.

**Geliştirme:**
1. `src/lib/portal-transfer/` (SAF, testli): portal başına form kural dosyası (`forms/sahibinden.json`...: kategori yolu, alan seçicileri,
   seçenek eşlemeleri, `maxPhotos`, `verified`), `buildPortalPayload`, `readinessCheck` (eksik zorunlu alan, EİDS uyarısı),
   `reverseMap` (içe aktarma).
2. Portföy formu ve `parseFeatureFields`: §4(e)-4'teki `features` anahtarları. Türkçe etiketler; "Portal için gerekli" rozeti.
3. Migration: `portal_transfer_sessions` + RPC'ler (`pt_prepare_session`, `pt_complete_session`). Tamamlama RPC'si içeride
   `lc_bind_portal_listing` çağırır. Taslak `migration-yazici` ile yazılır; canlıya uygulama onay ve yedekten sonra yapılır.
4. Uçlar: `POST /api/app/portal-aktar/hazirla`, `GET /api/app/portal-aktar/medya/[session]/[i]` (filigran, tek kullanımlık, kısa
   ömür), `POST /api/app/portal-aktar/tamamla`, `POST /api/app/portal-aktar/ice-al`. Hepsi aynı köken + özel başlık
   (`isSameOriginBridgeRequest`), `requirePermission` ve rate limit kullanır. `createAdminClient` gerekiyorsa kabul listesi güncellenir.
5. Eklenti 0.5.0: köprüye `transferStart/transferFill/transferDone` iletileri, portal sekmesinde doldurma paneli (enjekte edilen küçük UI),
   `DataTransfer` fotoğraf ekleme ve sürükle-bırak geri dönüşü, onay sayfasından ilan no okuma. `messages.ts` sözleşmesi, sürüm tek kaynağı
   (`extension-release.ts`) ve izin listesi değişmez (contract testi).
6. UI: portföy detayı Portallar sekmesinde portal kartları + hazırlık kontrolü çekmecesi; `/app/portallar`'da "Portaldan al" listesi
   (Zaten bağlı / Olası eşleşme / Yeni) + seçimli içe al; İlan kontrolü'nde "eksik portal" ve fark kartları. Her yeni sayfa veya bölüm için
   `loading.tsx`; sorgular `Promise.all` ile.
7. Ofis ayarı: "Yayınladığımız portallar" (eksik portal metriği için).
8. Mağaza: tek amaç ve izin gerekçesi metinleri, gizlilik politikası güncellemesi, yeniden gönderim (sahip).
9. Ölçüm: `portal_transfer_sessions` üzerinden alan doldurma oranı, tamamlanma oranı ve portal başına kırılma. İçgörü kuralı (v2):
   "3 aktif portföy hiçbir portalda yok" (kanıtlı, `href` zorunlu).
10. Temizlik (Ar-Ge kararı): `integrations/portals/index.ts`'ten `zingat` çıkarılsın; tahmini uçlar "sözleşme gelince yeniden
    yazılacak" diye işaretlensin; `portal-publish.ts` API yolu resmî ortaklık gelene kadar kapalı kalsın (bugün de yapılandırma yoksa
    kapalı).

**Kapsam dışı:** exe/RPA, tam otomatik veya zamanlanmış yayın, sunucudan portal okuma, portal mesajlaşması, mobil uygulama.

---

## Kaynaklar

- Sahibinden yardım: Kurumsal Emlak ve Vasıta Mağazalarına Sunulan Veri Transferi Yöntemleri (403; içerik arama özetinden):
  https://yardim.sahibinden.com/hc/tr/articles/19749005158172-Kurumsal-Emlak-ve-Vas%C4%B1ta-Ma%C4%9Fazalar%C4%B1na-Sunulan-Veri-Transferi-Y%C3%B6ntemleri
- Emlakjet: API ile İlan Transfer Sistemi Nedir ve Nasıl Kullanılır?: https://www.emlakjet.com/blog/api-ile-ilan-transfer-sistemi-nedir-ve-nasil-kullanilir
- Rekabet Kurulu kararı özeti (25-23/574-365, 26.06.2025): https://www.mfylegal.av.tr/haberler/sahibinden-api-veri-tasima-karari-26-06-2025/
- Sahibinden Ek-1 Kullanım Koşulları (403, okunamadı): https://www.sahibinden.com/sozlesmeler/ek-1-kullanim-kosullari-37
- Sahibinden Ek-7 Mağaza Kullanım Kuralları (okunamadı): https://www.sahibinden.com/sozlesmeler/ek-7-magaza-kullanim-kurallari-43
- Ticaret Bakanlığı İç Ticaret GM, EİDS yetki doğrulama: https://icticaret.ticaret.gov.tr/haberler/elektronik-ilan-dogrulama-sistemi-eids-yetki-dogrulama-uygulamasi-hayata-gecirildi
- EİDS Taşınmaz API'ye entegre firmalar duyurusu (Nisan 2026; liste Excel ekinde): https://icticaret.ticaret.gov.tr/duyurular/tasinmaz-ilanlarinda-eidsye-entegre-olan-firmalara-iliskin-duyuru-nisan-2026
- Entegre firma listesi kopyaları (403): https://www.alomaliye.com/2026/01/13/tasinmaz-ilanlarinda-eidsye-entegre-olan-firmalara-iliskin-duyuru/ ·
  https://www.alomaliye.com/2026/09/30/tasinmaz-ilanlarinda-eidsye-entegre-olan-firmalar-guncellendi-eylul-2026/
- Hepsiemlak EİDS haberi (403): https://www.hepsiemlak.com/emlak-yasam/haberler/emlak-haberleri/elektronik-ilan-dogrulama-sistemi
- RE-OS entegrasyonlar: https://re-os.com/entegrasyonlar · Emlakjet duyurusu: https://re-os.com/duyuru-detay/640/emlakjet-entegrasyonu-basladi · https://re-os.com/
- Emlak Asistanım: https://www.emlakasistanim.com/ · EmlakCRMx rehber: https://emlakcrmx.com/rehber/emlakci-yazilimi-2026-eksiksiz-secim-rehberi
- Emlaksis: https://suaresoft.com/emlak-ilan-sistemi/ · Edge Bilişim: https://edgebilisim.com/hizmetler/web-yazilim/gayrimenkul/ · K-ONTECH: https://k-ontech.com/sektorler/emlak · Rapitek: https://rapitek.com/en/real-estate-crm/
- Sahibinden toplu ürün girişi (e-ticaret, emlak değil): https://www.yenitoptanci.com/sahibinden-xml-urun-entegrasyonu · https://www.ayensoftware.com/entegrasyon/sahibinden-entegrasyonu/tr · https://mrtek.com.tr/e-ticaret-platformlariyla-entegrasyon-amazon-n11-ve-sahibinden-com/
- Forum görüşü (resmî değil): https://www.r10.net/sorum-var/4080315-sahibinden-entegrasyon.html · Bot doğrulama şikâyeti: https://www.sikayetvar.com/sahibinden/bot
- Zingat satışı: https://www.onlinemarketplaces.com/articles/property-finder-sells-turkish-portal-zingat-to-hepsiemlak-parent/ · https://www.dunya.com/sirketler/hepsi-emlak-zingati-satin-aldi-haberi-710082 · https://www.cbinsights.com/company/zingat/alternatives-competitors
- Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies · Tek amaç SSS: https://developer.chrome.com/docs/extensions/mv3/single_purpose/
- Dosya input'una programla dosya koyma: https://pqina.nl/blog/set-value-to-file-input/ · https://dev.to/code_rabbi/programmatically-setting-file-inputs-in-javascript-2p7i · https://medium.com/@dev_agam/automate-file-upload-with-chrome-extension-7ee6989d58e9 · https://greasyfork.org/tr/scripts/465827-pasteupload/code
- SmartScreen / kod imzalama: https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore · https://knowledge.gantner-instruments.com/gi.bench-installation-windows-warnings · https://learn.microsoft.com/en-us/answers/a/12761670 · https://ngrok.com/blog/windows-ev-certificate (çelişen görüş)
- Önceki iç belgeler: `docs/design/ILAN_KONTROL_EKLENTI_TASARIM_2026-10.md`, `docs/design/FSBO_ARASTIRMA_2026-10.md`
