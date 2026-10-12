# Sahibinden İlan Avı (FSBO) — Araştırma ve Tasarım Raporu (2026-10)

> Durum: TASARIM (kod değiştirilmedi). Tarih: 2026-10-12. Kapsam: sahibinden (FSBO = For Sale By Owner) satılık/kiralık
> ilan sahiplerinden portföy kazanımı. Hukuk bölümü ENGELLEMEZ, uyarır (proje kararı); ürün kararını besler, hukuki görüş değildir.
> İşaretler: **DOĞRULANMADI** = birincil kaynakta teyit edilemedi; fiyatlar ikincil kaynaklardan, sürekli değişir.

Arayüz adı önerisi: **"Sahibinden ilanlar"** (sekme), kod/rota adı **portföy avı** (`/app/portfoy-avi`, modül `prospecting`).
"FSBO" kelimesi arayüzde kullanılmaz (tamamen Türkçe kuralı).

---

## (a) Araştırma özeti

### a.1 Dünyadaki FSBO avı araçları — ne yapıyorlar

ABD pazarında FSBO/expired avı olgun bir kategori; araçların ortak çekirdeği şu altı parçadır:

1. **Günlük yeni ilan listesi** (FSBO, FRBO = sahibinden kiralık, expired = süresi dolan/yayından kalkan ilan). Vulcan7 expired verisini
   "günlük günceller, durumu her gece doğrular"; Landvoice "her yeni FSBO'yu her gün e-postalar".
2. **Sahip iletişim zenginleştirme** (ilanda olmayan telefonu/e-postayı kamu kayıtları + veri brokerlarından ekleme). Vulcan7: lead başına
   "genelde 2-3 doğrulanmış telefon ve e-posta". (ABD'ye özgü; Türkiye'de bu veri brokerlığı KVKK açısından mümkün DEĞİL — bkz. f.)
3. **Dialer** (tek/çok hatlı otomatik arama, yerel numara gösterimi, kayıt). REDX (WAVV altyapısı), Mojo (tek/üç hat), Vulcan7, Espresso.
4. **Hafif CRM + takip** (not, durum, sonraki arama, CRM'e aktarma — REDX Vortex → Follow Up Boss; Landvoice → Wise Agent API).
5. **DNC (Do Not Call) filtresi**: Vulcan7 "yerleşik DNC filtresi", REDX dialer DNC numaralarını işaretler ve doğrudan posta önerir.
6. **Script + koçluk** (Vulcan7 haftalık canlı koçluk, REDX University, itiraz yanıtları).

Ek sinyaller: expired'da "yeniden ilana çıkma" (relist) izleme, coğrafi hedefleme (REDX GeoLeads), fiyat/süre bazlı motivasyon.

### a.2 Rakip özellik tablosu

| Araç | Günlük FSBO | FRBO | Expired | İletişim zenginleştirme | Dialer | CRM | DNC | Script/koçluk | Fiyat (ikincil kaynak, DOĞRULANMADI) |
|---|---|---|---|---|---|---|---|---|---|
| Vulcan7 | Var (sıklık belirtilmemiş) | Var | Günlük + gece doğrulama | 2-3 tel/e-posta | Yerleşik | Yerleşik + dışa aktarım | Yerleşik filtre | Haftalık koçluk dahil | ~$250-359/ay; Capterra $299 |
| REDX | Var | Var | Var | "Plus Insights" (tel, e-posta, posta adresi) | Power Dialer (WAVV), yerel numara, kayıt | Vortex (tam CRM yerine geçmez) | Dialer işaretler | REDX University, bootcamp | Core $199 · Connect $299 · Pro $349/ay (2026-09 inceleme) |
| Landvoice | Her gün e-posta | Yok (FitSmallBusiness) | Var, çok kaynaklı eşleştirme | Expired'a sahip iletişimi ekler | Yok (kendi dialer'ını getir) | CRM entegrasyonu (Wise Agent API) | 2009 tarihli kanıt, güncel DOĞRULANMADI | Yalnız başlangıç videoları | ~$97-399/ay |
| Espresso Agent | Var | Var | Var | Var | Yerleşik | Yerleşik | DOĞRULANMADI | DOĞRULANMADI | ~$249-399/ay |
| Mojo Dialer | Veri eki (ilçe/county bazlı) | Var | Var (50 mil yarıçap) | Veri eki | Tek/üç hat (dialer ana ürün) | Basit | DOĞRULANMADI | — | Dialer $99-149/ay + FSBO $25, expired $50/ay |
| EmlakCRMx (TR) | — | — | — | — | — | Var | — | — | ~$86/ay yıllık; "sahibinden.com'dan otomatik içe aktarma" (kendi ilanları; üretici beyanı) |
| Apify "Sahibinden Phone/Real Estate Scraper" (TR) | Kazıma | — | — | Telefon kazıma | — | — | — | — | Örnek olarak anılır; EmlakSoft bu yolu KULLANMAZ (bkz. f) |
| RE/MAX, Coldwell Banker TR iç araçları; Emlakjet Pro | DOĞRULANMADI — kamuya açık özellik belgesi bulunamadı | | | | | | | | |

**Ürün dersi:** Değer listede değil, **takip disiplininde** (kim, ne zaman, kaçıncı temas) ve **çakışma önlemede** (aynı ofisten iki kişinin
aynı ilan sahibini araması). Türkiye'de veri satın alma/zenginleştirme yolu kapalı olduğundan EmlakSoft'un avantajı: danışmanın kendi
gördüğü ilanı tek tıkla kaydetmesi + ofis içi tekilleştirme + hazır takip ritmi + portföye tek tıkla dönüşüm.

### a.3 Dönüşüm metrikleri ve en iyi uygulamalar (kaynak kalitesine dikkat)

| Bulgu | Değer | Kaynak / güven |
|---|---|---|
| ABD'de FSBO satış payı | %5 (2025, tarihî dip; 1980'lerde %21'e kadar) | NAR 2025 Profili, ikincil kaynaklar (Virginia Realtors, nowbam) — NAR PDF'inden doğrudan DOĞRULANMADI |
| Satıcıların emlakçıyla çalışma oranı | %91 (2024-07 → 2025-06) | aynı |
| Soğuk aramada bağlantı oranı | ~%28; ~209 aramada 1 randevu/tavsiye | Baylor Keller Center, getperspective.ai üzerinden ikincil |
| İlk 1 saatte dönüş | ~7 kat daha anlamlı görüşme olasılığı | HBR (Oldroyd, "The Short Life of Online Sales Leads", 2011), ikincil özet |
| Expired satıcıya ilk 48 saatte gelen arama | çoğu zaman 20+ | getperspective.ai (satıcı içeriği) |
| Expired ilanın farklı danışmanla yeniden çıkması | %51; ~%40'ı 30 gün içinde | Vulcan7 sayfası (satıcı içeriği) |
| FSBO satıcının hazır hale geldiği temas | 5.-6. temas | eğitim içeriği (therealestatetrainer), kural-of-thumb |
| Takip aralığı | 7-10 günde bir, her seferinde farklı değer (yeni emsal, piyasa notu, alıcı talebi) | estatepass.ai (satıcı içeriği) |
| İlk temasta yaklaşım | yetki isteme, ilişki iste; ilk aramada agresif randevu kapatma | iki ayrı eğitim kaynağı |
| En iyi danışmanların temas ettiği FSBO'dan yetki alma oranı | ~%20 | eğitim kaynağı, DOĞRULANMADI |
| TR pratiği: "1 ay sonra görüşelim" diyene ~15 gün sonra dön; itirazda tartışma, alıcın varsa getirmeyi teklif et; profesyonel tanıtım dosyası | — | Milliyet Emlak (2017) |

**Tasarıma çevirisi:** (1) Yeni kaydedilen ilan aynı gün aranmalı (hız = rekabet; Türkiye'de de sahibinden ilan sahibine ilk günlerde
çok sayıda emlakçı ulaşıyor — şikâyet haberleri bunu gösteriyor). (2) Varsayılan takip ritmi: **0. gün → 3. gün → 7. gün → 14. gün → 21. gün
→ 30. gün** (6 temas; sonra ayda bir, ilan yayından kalkana dek). (3) Her takipte "değer" kartı: yeni emsal / fiyat düşüşü / eşleşen talep sayısı.
(4) Arama saatleri önerisi (08-11 / 16-18) tek satıcı kaynağından, bağımsız veri yok → yalnız ipucu metni, kural değil.

### a.4 Türkiye bağlamı

- **Sahibinden/emlakçı oranı:** sahibinden.com, hepsiemlak, emlakjet'te "sahibinden" ilan payını veren kamuya açık istatistik
  **bulunamadı (DOĞRULANMADI)**. BETAM/sahibindex raporları ilan veren tipine göre kırılım vermiyor.
- **"Kimden" filtresi:** sahibinden.com'da ilan veren tipine göre (Sahibinden / Emlak Ofisinden / İnşaat Firmasından / Bankadan) filtre
  olduğu sektörde bilinir; resmi belgede **DOĞRULANMADI** (üçüncü taraf kazıyıcı çıktılarında `sellerType: "Sahibinden"` alanı görülüyor).
  hepsiemlak/emlakjet karşılığı DOĞRULANMADI. Ürün bu filtreye güvenmez; danışmanın açtığı ilanı kaydetmesine dayanır.
- **"Sahibinden" görünen emlakçı ilanı sık:** Şikâyetvar kayıtları "sahibinden filtresinde çıkan ilanların neredeyse hepsi emlakçı" diyor
  (anekdot). → Kayıp nedeni listesinde **"Aslında emlakçı"** zorunlu seçenek; o telefon ofis genelinde işaretlenir.
- **EİDS (Elektronik İlan Doğrulama Sistemi):** 1 Ocak 2025'ten beri tapulu taşınmaz ilanı yetki doğrulamasız verilemez; bireysel ilanda
  ilanı veren malik, eşi veya 1./2. derece kan hısımı olmalı; emlakçı ilanı için malikin e-Devlet'ten emlakçıyı yetkilendirmesi zorunlu;
  hisseli taşınmazda tek hissedarın yetkisi yeterli; yetki en az 3 ay uzatılabilir; tapusuz/yabancı malik istisnaları var (2024 sonu haberleri;
  sonrası değişiklik DOĞRULANMADI). **Sonuç:** FSBO → portföy dönüşümünde "yetki alındı" = (1) yazılı yetkilendirme sözleşmesi + (2) malikin
  EİDS'te ofisi yetkilendirmesi. EmlakSoft'ta mevcut `src/lib/eids/**` (yetki durumu/süresi) bu adıma bağlanır. Ayrıca EİDS, sahibinden
  ilanlarının gerçekten malikten gelme olasılığını artırmıştır (yan etki; ölçülmedi).
- **Yetkilendirme sözleşmesi ve hizmet bedeli (Taşınmaz Ticareti Hakkında Yönetmelik):** yazılı, en az 2 nüsha, süre ≤ 3 ay; hizmet bedeli
  satışta toplam KDV hariç %4'ü (aksi kararlaştırılmadıkça taraflar eşit → yaygın uygulama alıcı %2 + satıcı %2), kirada bir aylık kira tutarını
  aşamaz; hak kazanma satışta tapu tescili, kirada sözleşmenin kurulması; yetki belgesi olmadan emlakçılık yapılamaz/ilan sitesine üye olunamaz
  (ikincil kaynaklar, 2018/2020 değişiklikleri; güncel metin mevzuat.gov.tr'den DOĞRULANMADI). → "Komisyon ödemem" itirazı scriptinde
  oranlar bu kaynaktan (`src/lib/...` tek kaynak), elle yazılmaz.
- **Danışman pratiği:** ilk temasta güven + mülkü görme + fiyatın nasıl belirlendiğini sorma; itirazda tartışmama; "alıcım varsa getiririm";
  15 gün sonra tekrar; tanıtım dosyası (Milliyet Emlak). Kira ilanında fahiş fiyat vaadi ters tepiyor (Ankara vakası, Ticaret Bakanlığı'nın
  889 işletmeye fahiş fiyat cezası haberi) → script "daha yüksek fiyata satarım" vaadi İÇERMEZ; emsal verisiyle konuşur.
- **Rekabet Kurulu:** (1) 2023: sahibinden.com'a 40,1 milyon TL ceza; kurumsal üyelerin KENDİ ilan verisini başka platforma taşımasını
  engelleme → bedelsiz veri taşıma altyapısı kurma yükümlülüğü. Bu FSBO ilanlarını KAPSAMAZ (yalnız üyenin kendi ilanı). (2) 2025-02:
  vasıta/Otobid soruşturması ve geçici tedbirler — emlak/FSBO ile ilgisiz.
- **KVKK veri ihlali 2023/504 (sahibinden):** ~71.422 kişinin verisi "web servis içeriklerinin kopyalanması suretiyle" elde edildi ve
  "siber saldırı" olarak bildirildi. **Ürün çıkarımı:** toplu otomatik kopyalama platform ve Kurum gözünde saldırıdır; EmlakSoft sunucu tarafı
  kazıma yapmaz (zaten kalıcı karar: İLAN_KONTROL tasarımı §2.4).

---

## (b) EmlakSoft için önerilen MVP kapsamı

### b.1 Kapsam (MVP = "Kaydet → Ara → Takip → Portföye dönüştür")

DAHİL:
1. İlan kaydı: **eklentiden "Kaydet"** (kullanıcının açtığı sekme, tıklama anında) + **elle ekleme** (ilan bağlantısı yapıştır + PhoneInput).
2. Ofis içi tekilleştirme ve sahiplik (aynı ilanı ikinci danışman kaydedemez; "Ayşe 2 gün önce kaydetti, ilgileniyor").
3. Durum akışı + arama sonucu kaydı + otomatik "sonraki arama" tarihi (takip ritmi).
4. Aranmasın listesi (ofis geneli, telefon özeti ile kalıcı).
5. Fiyat geçmişi (her yeniden kayıt/elle güncelleme = gözlem), fiyat düşüşü ve tekrar ilan tespiti.
6. Portföye dönüştür (müşteri "Satıcı" + portföy taslağı + yetki adımı).
7. İçgörü kartları (mevcut `insights` motoru, yeni cron YOK) + rapor merkezi tanımı.
8. Saklama süresi + otomatik kişisel veri temizliği.

HARİÇ (MVP dışı / bilinçli YOK):
- Sunucu tarafı toplu kazıma, portal arama sonuçlarının otomatik taranması, "günlük yeni FSBO listesi" beslemesi. YOK.
- Otomatik/toplu arama (dialer), robot arama, toplu SMS/WhatsApp. YOK (İYS riski; ayrıca kullanıcı arar: `tel:` bağlantısı).
- İletişim zenginleştirme (başka kaynaktan telefon bulma). YOK (KVKK; 2023 finans şirketi 1 mn TL cezası benzeri risk).
- İlan fotoğraflarını kopyalama. YOK (telif; yalnız ilan bağlantısı saklanır).
- Harita: v2 (ilan konumu çoğu zaman yalnız mahalle düzeyinde; ilçe merkezli küme haritası yeterli olur).
- Eklentinin kayıtlı FSBO ilanlarını kendiliğinden yeniden kontrol etmesi: v2, ofis ayarı, **varsayılan KAPALI** (sahip kararı; bkz. c.4).

### b.2 Veri modeli

**`fsbo_leads`** (tenant_id + RLS; `public.current_tenant_id()`):

| Alan | Tür | Not |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null → tenants | RLS |
| branch_id | uuid null → branches | kapsam (`applyActorScope`) |
| assigned_to | uuid null → profiles | sahiplik; kaydeden varsayılan |
| created_by | uuid → profiles | |
| source | text check (`extension`,`manual`,`import`) | |
| portal | text check (`sahibinden`,`hepsiemlak`,`emlakjet`,`other`) | adaptör kayıt defteriyle aynı anahtarlar |
| external_id | text null | portal ilan no |
| url | text null | `https://` + izinli portal hostu doğrulanır |
| title | text null (≤200) | |
| transaction_type | text check (`sale`,`rent`) | |
| property_type | text null | tanımlar (`definitions`) ile uyumlu |
| price | numeric null; currency text default `TRY` | son bilinen fiyat |
| rooms, gross_m2, net_m2 | text/int null | |
| province_id, district_id | uuid null → geo_* | `src/lib/geo/**` |
| location_text | text null | portalın mahalle metni |
| listed_at | date null | portalın ilan tarihi (ayrıştırılabilirse) |
| first_seen_at / last_seen_at | timestamptz | ilk/son gözlem |
| listing_status | text check (`active`,`removed`,`unknown`) default `unknown` | "bulunamadı" ASLA "kalktı" sayılmaz (mevcut dürüstlük kuralı) |
| owner_name | text null | yalnız ilanda görünen ad; TC/vergi no YOK (kalıcı karar) |
| phone | text null | `parsePhoneStrict` → `stored` |
| phone_hash | text null | `sha256(tenant_salt ‖ stored)`; aranmasın + tekrar ilan eşleşmesi |
| status | text check (`yeni`,`arandi`,`randevu`,`yetki_alindi`,`portfoye_donustu`,`kayip`) default `yeni` | |
| status_changed_at | timestamptz | |
| lost_reason | text null check (`satti`,`emlakci_istemiyor`,`baska_ofis`,`fiyat_gercekci_degil`,`ilan_kalkti`,`aslinda_emlakci`,`ulasilamadi`,`diger`) | |
| contact_attempts | int default 0 | |
| last_contact_at | timestamptz null | |
| next_action_at | timestamptz null | takip ritmi (`cadence.ts`) yazar |
| price_drop_count | int default 0; last_price_drop_pct numeric null | gözlemlerden türetilir |
| relist_of | uuid null → fsbo_leads | tekrar ilan zinciri |
| customer_id | uuid null → customers | randevu/dönüşümde oluşur |
| property_id | uuid null → properties | dönüşümde oluşur |
| converted_at | timestamptz null | |
| claim_expires_at | timestamptz null | sahiplik süresi (varsayılan 14 gün hareketsizlik) |
| is_sample | boolean default false | örnek veri kuralı: içgörü üretmez |
| pii_purged_at | timestamptz null | saklama süresi dolunca ad/telefon/not silinir |
| created_at, updated_at, deleted_at | timestamptz | |

İndeksler: `unique (tenant_id, portal, external_id) where external_id is not null and deleted_at is null`;
`(tenant_id, status, next_action_at)`; `(tenant_id, assigned_to, status)`; `(tenant_id, phone_hash)`; `(tenant_id, district_id)`.

**`fsbo_lead_observations`** (fiyat geçmişi): id, tenant_id, lead_id (cascade), observed_at, price, currency, listing_status,
source (`extension`,`manual`,`recheck`), observed_by. Fiyat düşüşü = ardışık iki gözlemde fiyat ↓ (eşik ≥ %1, `thresholds` saf dosyada).

**`fsbo_lead_activities`** (zaman çizelgesi): id, tenant_id, lead_id, actor_id, kind (`call`,`note`,`status`,`meeting`,`message`),
outcome (`ulasilamadi`,`mesgul`,`gorusuldu`,`ilgilenmiyor`,`sonra_ara`,`randevu`,`yetki`,`aranmasin`), note (≤1000), created_at.
Karar: mevcut `calls` tablosuna YAZILMAZ — `calls.phone` kalıcıdır ve FSBO saklama süresiyle çelişir; KPI/Lig entegrasyonu v2'de
`loadLeagueActivity` (tek aktivite kaynağı) içine bu tablodan sayı (telefonsuz) eklenerek yapılır.

**`fsbo_do_not_call`** (aranmasın): id, tenant_id, phone_hash, reason (`ilan_sahibi_istedi`,`aslinda_emlakci`,`diger`), created_by,
created_at; `unique (tenant_id, phone_hash)`. Ham telefon SAKLANMAZ → lead temizlense de "aranmasın" kalır (itiraz hakkına saygı için
minimum veri). Ekleme/çıkarma denetim kaydına (`audit`) düşer; çıkarma yalnız yönetici.

**`tasks`'a ek:** `fsbo_lead_id uuid null → fsbo_leads on delete set null` (müşteri oluşmadan önce "Pazartesi tekrar ara" görevi için).
Randevu (`appointments`) müşteri ister → "Randevu" eylemi önce müşteriyi (Satıcı, kaynak "Sahibinden ilan") oluşturur, `customer_id`'yi bağlar.

### b.3 Durum akışı

```
yeni ──(ara: görüşüldü/sonra ara)──► arandi ──(randevu)──► randevu ──(yetki sözleşmesi + EİDS)──► yetki_alindi ──(portföye dönüştür)──► portfoye_donustu
  │                                    │                      │                                   │
  └──────────────────────────(her adımdan)──────────────────────────────────────────────────────────► kayip (lost_reason zorunlu)
Aranmasın: durum DEĞİL, bayrak (fsbo_do_not_call). İşaretlenince lead `kayip/emlakci_istemiyor` olur, ara/görev eylemleri kilitlenir.
```

Kurallar (saf `src/lib/prospecting/state-machine.ts`, test edilir):
- `ulasilamadi` sonucu durumu değiştirmez, `contact_attempts++`, `next_action_at` ritimde ilerler; 6 başarısız denemeden sonra öneri: "Kayıp: ulaşılamadı".
- `yetki_alindi` → yalnız yetkilendirme sözleşmesi tarihi + süresi (≤ 3 ay uyarı, engel değil) girilince; EİDS durumu mevcut okuyucudan gösterilir.
- `portfoye_donustu` geri alınamaz (portföy silinirse lead `kayip/diger` değil, olduğu gibi kalır; kanıt zinciri).
- `kayip` → yeniden açılabilir ("Yeniden dene"): tekrar ilan tespiti bunu önerir.

### b.4 Tespitler

- **İlk görülme:** `first_seen_at` = ofiste ilk kayıt; `listed_at` portaldan ayrıştırılırsa "ilan yaşı" onu kullanır, yoksa `first_seen_at` ("en az N gün" etiketiyle).
- **Fiyat düşüşü:** yeni gözlem fiyatı < önceki → `price_drop_count++`, `last_price_drop_pct`; içgörü üretir. Yükseliş kaydedilir, sinyal değildir.
- **Tekrar ilan (relist):** yeni kayıtta (a) aynı `phone_hash` veya (b) aynı ilçe + oda + m² (±%3) + fiyat (±%10) ile `kayip/ilan_kalkti` ya da
  `removed` bir lead varsa → `relist_of` bağlanır, kart "Yeniden ilana çıktı (önceki: 12 Eyl, 4,2 mn → şimdi 3,9 mn)" der. (b) yalnız öneridir, kullanıcı onaylar
  (mevcut `listing-control/matching.ts` skor yaklaşımı yeniden kullanılır; kopya motor yazılmaz).
- **Ofisin kendi portföyüyle çakışma:** kayıtta `portal_listings`/`properties` ile ilan no/URL birebir eşleşirse "Bu ilan zaten ofisinizin portföyünde" uyarısı.
- **Müşteriyle çakışma:** telefon mevcut müşteride varsa kart müşteriye bağlanır ("Bu numara Mehmet Yılmaz (Satıcı) kaydında").
- **Aranmasın:** kayıt anında `phone_hash` listede ise kayıt yapılır ama kart "Aranmasın" rozetiyle, eylemler kilitli; danışmana kimin/ne zaman işaretlediği gösterilir.

---

## (c) Ekranlar ve eklenti entegrasyonu

### c.1 Yerleşim (menü ilkesi)

Yeni menü satırı YOK. **Portföyler merkezine sekme**: `src/lib/nav-roles.ts` `ILANLAR.pages` listesine
`p("/app/portfoy-avi", "Sahibinden ilanlar")` — Portföyler'den hemen sonra (danışman için ikinci en sık iş). Mevcut 7 sayfa + bu = 8;
şerit 5 görünür + "Diğer" kuralında Filigran/Sunumlar/Anahtarlar "Diğer"e iner (ofis düzeni `ILANLAR_YONETIM` 7). Mobil alt çubuk değişmez;
"+ Yeni" eylem sayfasına **"Sahibinden ilan ekle"** satırı eklenir (`mobile-new-sheet.tsx`).

### c.2 Liste sayfası `/app/portfoy-avi`

- `PageHeader` + `StatRow` (hepsi tıklanabilir, `href` filtreli — sıfır çıkmaz metrik):
  **Bugün aranacak** (`?gorunum=bugun`) · **Yeni** (`?durum=yeni`) · **Randevu** (`?durum=randevu`) · **Yetki alındı** · **Bu ay dönüşen** (`?durum=portfoye_donustu&donem=bu-ay`).
  Veri yoksa kart yok; anlamlı boş durum: "Henüz sahibinden ilan kaydetmediniz — eklentiyi kurun ya da ilan bağlantısını yapıştırın" + iki düğme.
- `FilterBar` (iki yönlü URL kontratı, sunucu filtresi + gerçek sayfalama, ilk sayfa 30): durum, danışman (kapsam), satılık/kiralık, il/ilçe
  (`PersonSelect`/Combobox desenleri), fiyat aralığı, ilan yaşı (0-3 / 4-14 / 15-45 / 45+ gün), "fiyatı düştü", "tekrar ilana çıktı",
  "aranmasınları göster" (varsayılan gizli), arama (başlık/ilan no; trgm).
- Varsayılan sıralama: `next_action_at` artan (gecikenler kırmızı), sonra yeni kayıtlar.
- Satır/kart: başlık, fiyat (+ "↓ %4" rozeti), ilçe·mahalle, oda/m², ilan yaşı, son temas ("3 gün önce · ulaşılamadı"), sonraki eylem tarihi, sahip danışman.
  İlk 5 satır `prefetchFullNow`. Mobilde kart düzeni, dokunma hedefi ≥ 44 px.
- Kart eylemleri (sayfa içi panel/sheet, popup YOK):
  - **Ara** → `tel:` bağlantısı (mobilde birincil) + aynı anda "Arama sonucu" sheet'i (ulaşılamadı/meşgul/görüşüldü/ilgilenmiyor/sonra ara/randevu/aranmasın + not).
    İlk aramada **script kartı** açılır (c.3).
  - **Not**, **Görev** (`tasks.fsbo_lead_id`), **Randevu** (müşteri otomatik oluşur), **Portföye dönüştür**, **Aranmasın**, **Kayıp** (neden zorunlu), **İlanı aç** (yeni sekme).
- Detay paneli: zaman çizelgesi (`fsbo_lead_activities`), fiyat geçmişi mini grafiği (`ui/chart`), tekrar ilan zinciri, eşleşen talep sayısı
  (mevcut eşleştirme okuyucusu; "Bu evi arayan 3 aktif talebiniz var" = ilan sahibine söylenecek değer, `href` → eşleşmeler), EİDS/yetki durumu.
- Rapor: dışa aktarma düğmesi YOK. Rapor merkezi `catalog/*` içine **"Sahibinden ilan hunisi"** (durum adetleri, dönüşüm oranı, kayıp nedenleri,
  danışman bazında; kiracı sınırı `tid(ctx)` + `applyActorScope`; telefon/ad kolonu YOK).
- HIZ: `loading.tsx` zorunlu; sayım + liste `Promise.all`; ağır grafik `next/dynamic`; realtime listesi `realtime-throttle.ts`'e `fsbo_leads` (tenant filtreli).

### c.3 Script ve itiraz kartı (statik, ofis düzenleyebilir — v2)

1. **Açılış (yasal kimlik dahil):** "Merhaba, ben {ad}, {ofis ticaret unvanı} — yetki belge no {no}. {ilçe}'deki {oda} ilanınız için arıyorum,
   uygun musunuz?" (6563 yönetmeliği sesli aramada tacirin ticaret unvanını, esnafın ad-soyadını söylemesini öngörür.)
2. **Neden:** gerçek değer — "Bu bölgede {N} aktif alıcı talebimiz var" (veri yoksa bu cümle GÖSTERİLMEZ; sahte vaat yasak).
3. **Soru (ilişki, yetki değil):** "Fiyatı nasıl belirlediniz? Ne zamana kadar satmayı düşünüyorsunuz?"
4. **İtirazlar:** "Komisyon ödemem" → hizmet bedeli kuralları + ne sunulduğu; "Kendim satarım" → "Uygun alıcı çıkarsa size getireyim mi?";
   "Çok emlakçı aradı" → "Anlıyorum; listemden çıkarmamı ister misiniz?" (→ Aranmasın).
5. **Kapanış:** "Sizi {tarih} tekrar arayabilir miyim?" → `next_action_at`. **"Tekrar aranmak istemiyorum" → tek dokunuş Aranmasın.**

### c.4 Eklenti entegrasyonu (`extensions/emlaksoft-ilan-kontrol`, v0.4)

Mevcut durum (kodda doğrulandı): MV3; `permissions: storage, alarms`; `host_permissions` adaptör kayıt defterinden yalnız sahibinden/hepsiemlak/emlakjet
(`scripts/build-extension.ts`); içerik betiği YALNIZ EmlakSoft kökeninde (köprü: `window.postMessage`, `bridge.ts`); oturum tokenı saklanmaz;
EmlakSoft'a yükleme bekleyen iş kuyruğu deseni var (`scanUploads`/`scanPendingDue`); HTML ayrıştırıcılar `src/lib/listing-control/adapters/html/*`
(`parse-core.ts`, `portal-rules.json`, `ObservedListing`).

Önerilen akış (kullanıcı eylemi, tek ilan):
1. Danışman portalda bir ilan detayını kendisi açar → eklenti simgesine tıklar → açılır pencerede **"EmlakSoft'a kaydet"**.
2. Tıklama anında `activeTab` + `chrome.scripting.executeScript` ile YALNIZ o sekmenin DOM'u okunur (arka planda gezinme/izleme YOK; tıklama
   olmadan hiçbir portal sayfası okunmaz). Ayrıştırma mevcut adaptörle (`parse-core`), `ObservedListing` FSBO alanlarıyla genişletilir
   (oda, m², konum metni, ilan tarihi, ilan veren tipi, görünen ad).
3. **Telefon:** eklenti "numarayı göster"e TIKLAMAZ. Numara sayfada kullanıcı tarafından açılmış ve görünürse açılır pencerede ön-dolu gösterilir,
   kullanıcı onay kutusuyla gönderir; değilse açılır pencerede PhoneInput eşdeğeri alana elle yazar. Sunucu `parsePhoneStrict` ile doğrular.
4. Açılır pencere önizleme gösterir (başlık, fiyat, ilçe, telefon) + aranmasın/çakışma sonucu (EmlakSoft yanıtı geldiğinde).
5. Gönderim: SW kuyruğa yazar (`fsboPending`, `scanUploads` deseni) → açık EmlakSoft sekmesindeki içerik betiği oturumlu
   `POST /api/app/portfoy-avi/kaydet` çağırır (idempotent anahtar: portal + ilan no). EmlakSoft sekmesi yoksa: "EmlakSoft'u açın, kayıt otomatik gönderilecek".
6. Aynı ilanı yeniden kaydetmek = yeni gözlem (fiyat geçmişi); "Bu ilan kayıtlı — güncelle" düğmesi.

İzin değişikliği: `activeTab`, `scripting` eklenir (host izni zaten var). Chrome Web Store: tek amaç metni "emlak ofisinin portal ilanlarını
yönetmek: kendi ilanlarını kontrol etmek ve kullanıcının açtığı ilanı ofis kaydına eklemek" olarak güncellenir; Limited Use politikası
(kazınan/otomatik toplanan veri dahil; yalnız beyan edilen amaç için gerekli veri; gezinme etkinliği toplama yasağı, kullanıcıya dönük özellik
hariç) ve gizlilik politikası güncellenir. **Risk:** iki işlevin "tek amaç" sayılması mağaza incelemesinde sorgulanabilir (DOĞRULANMADI);
yedek plan ayrı küçük eklenti "EmlakSoft İlan Kaydet". Mağaza gönderimi sahibin işi.

Elle ekleme (eklentisiz, mobil dahil): bağlantı yapıştır → URL'den portal + ilan no çıkarılır (mevcut adaptör URL ayrıştırıcıları), kalan alanlar
formdan; sunucu portal sayfasını ÇEKMEZ.

v2 (sahip kararı, varsayılan KAPALI): kayıtlı FSBO ilanlarının mevcut düşük hızlı doğrulama kuyruğuyla günde ≤ 1 kez, ofis başına ≤ 50 ilan
yeniden kontrolü (fiyat/yayın durumu). Bu, ofisin KENDİ ilanı olmayan sayfaya otomatik erişimdir → ToS riski kendi ilanlarından yüksektir;
açılırken kullanıcıya açık uyarı, engel (403/CAPTCHA) görülünce mevcut 30 dk durma kuralı.

---

## (d) Otomasyon ve içgörü kuralları

Yeni cron YOK (36 sözleşmesi korunur). Kurallar SAF `src/lib/insights/rules/prospecting.ts`, kayıt `rules/index.ts`, okuyucu facts
`src/lib/insights/prospecting-facts.ts`; üretici mevcut `insight-engine` cron'u. `insights.kind` CHECK kapalı liste → yeni kind GEREKMEZ
(`call_priority` kullanılır), migration yok. Her kart: kanıt satırı (telefon/ad YOK), `href` zorunlu, son geçerlilik, örnek veri hariç.

| Kural kimliği | Koşul (eşikler `thresholds.ts`) | Kart metni | href |
|---|---|---|---|
| `fsbo_uncalled@1` | `status=yeni`, `contact_attempts=0`, kayıt ≥ 1 gün (danışman bazlı; "3 gün" yüksek önem) | "3 sahibinden ilan kayıttan beri aranmadı" | `/app/portfoy-avi?durum=yeni&aranmadi=1` |
| `fsbo_followup_due@1` | `next_action_at` ≤ bugün, durum açık | "Bugün 4 ilan sahibini tekrar arama günü" | `?gorunum=bugun` |
| `fsbo_price_drop@1` | son 7 günde fiyat düşüşü gözlemi, durum `yeni/arandi/kayip(ilan dışı)` | "Kadıköy 3+1 ilanında fiyat %5 düştü — sahibi esnemeye hazır olabilir" | `?fiyat_dustu=1` |
| `fsbo_relisted@1` | yeni kayıt `relist_of` dolu | "Önceden kaybettiğiniz ilan yeniden yayında" | `/app/portfoy-avi/{id}` |
| `fsbo_aging@1` | ilan yaşı ≥ 45 gün, aktif, son temas ≥ 14 gün | "45 gündür satılamayan 2 sahibinden ilan: değer odaklı yeniden temas" | `?yas=45&durum=arandi` |
| `fsbo_claim_expiring@1` (yönetici) | `claim_expires_at` 2 gün içinde | "Ayşe'nin 5 ilanı hareketsiz — sahiplik 2 gün içinde düşecek" | `?danisman=..&hareketsiz=1` |

Kapanış: arama sonucu kaydedilince ilgili kart kapanır (mevcut `close-on-contact.ts` deseni). LLM anlatımı varsayılan KAPALI (mevcut kural).

Otomasyon motoru (`src/lib/automation-engine.ts`, sayfa Profesyonel paket):
- Olay tetikleyici `new_fsbo_lead` (eylem: görev oluştur / sahibine bildirim). Zamanlı `fsbo_no_contact_days` (`no_contact_days` benzeri).
- Eylemler arasında **SMS/WhatsApp gönderimi FSBO kayıtları için devre dışı** (İYS onayı yok); yalnız görev/bildirim. Kampanyalar modülü
  `fsbo_leads`'i hedef kitle olarak hiç görmez (sözleşme testi).
- Takip ritmi motor gerektirmez: arama sonucu kaydı `next_action_at`'i saf `cadence.ts` ile yazar (0/3/7/14/21/30, sonra 30 günde bir;
  "sonra ara: tarih" kullanıcı tarihini önceler).

Ana ekran (Bugün): mevcut içgörü şeridinden gelir; ayrı blok açılmaz.
Sahiplik düşmesi ve saklama temizliği: mevcut günlük bir cron'a (ör. `insight-engine` veya `gunluk-ozet`) adım olarak eklenir, `recordHeartbeat` korunur.

---

## (e) Yetki, menü, modül ve paket yerleşimi (4 kayıt yeri)

1. **`src/lib/permissions.ts`:** `AppModule`'e `"prospecting"`. MATRIX: owner/gm/branch_manager/team_lead `ALL`; advisor `CRUD_NO_DEL`;
   call_center `["view","create","edit"]` (ofis çağrı merkezi arayabilir — sahip kararı, varsayılan bu); accounting yok; readonly `VIEW`.
   Kapsam: danışman yalnız kendi + sahipsiz kayıtlar; yönetici ofis/şube (`src/lib/access-control/**`, `applyActorScope`).
   Her server action `requirePermission("prospecting", ...)`; sayfa `requireModulePage("prospecting", "/app/portfoy-avi")`.
2. **`NAV_MODULES`** (`src/app/app/layout.tsx`) + `src/lib/nav-config.ts` NAV_SECTIONS'a sayfa kaydı (anahtar sözcükler: sahibinden, ilan sahibi, portföy avı, aranmasın).
3. **Sidebar / merkez:** yeni satır YOK; `nav-roles.ts` `ILANLAR.pages` sekmesi (c.1). `nav-budget-contract` etkilenmez. (`app-sidebar.tsx` merkezleri
   `nav-roles`'tan okuyorsa ek iş yok — uygulamada kontrol edilecek.)
4. **Roller ekranı** `src/app/app/ayarlar/roller/` MODULES listesi + **`permission_defaults` seed migration'ı** (ayrı dosya).

Modül aç/kapa (`src/lib/modules/registry.ts`): yeni FeatureKey `prospecting`, grup `pazarlama` (veya portföy kazanımı), `routes: ["/app/portfoy-avi"]`,
kurulum sorusu: "Sahibinden ilan veren mal sahiplerini arayıp portföy topluyor musunuz?" (hayır → kapalı); `stops`: "Sahibinden ilan içgörüleri
üretilmez; eklentide Kaydet düğmesi gizlenir (kayıtlar silinmez)".

Paket (`src/lib/billing/page-gates.ts`): **MVP sayfası tüm paketlerde açık** (Danışman paketindeki bireysel danışman bu özelliğin ana kullanıcısı;
portföy kazanımı çekirdek iş). Otomasyon tetikleyicileri zaten `/app/otomasyonlar` Profesyonel kilidinde. Ofis içi sahiplik/yönetici kartı tek
kullanıcıda anlamsız olduğundan kendiliğinden görünmez (kilit gerekmez). Paket kuralı değişecekse yalnız `page-gates.ts` + `plans.ts`.

Diğer zorunlu kayıtlar: `createAdminClient` YOK (her şey kullanıcı oturumu + RLS; allowlist değişmez); telefon girişleri `PhoneInput`,
sunucu `parsePhoneStrict` (`contact-input-contract.test.ts`); PostgREST gömmelerinde `fsbo_leads` → `customers`/`properties` FK adıyla
(`alias:properties!fsbo_leads_property_id_fkey(...)`); bileşenlerde zaman `clock.ts`.

---

## (f) Hukuki uyarılar ve ürün metinleri

### f.1 Risk özeti (ürün kararı için; hukuki görüş DEĞİL — metin sorumluluğu ofis sahibinde, kalıcı karar)

| Konu | Durum | Ürün kararı |
|---|---|---|
| Portal kullanım şartları / kazıma | sahibinden sözleşmesinin otomatik erişim maddesi metni DOĞRULANMADI; platform agresif bot koruması kullanıyor (kazıyıcı satıcılar söylüyor); KVKK 2023/504: web servis kopyalama "siber saldırı" olarak bildirildi | Sunucu kazıması YOK; yalnız kullanıcı tıklamasıyla tek ilan; v2 yeniden kontrol opt-in |
| KVKK hukuki sebep | Telefonu ilan sahibi kendisi yayımladı → md.5/2-d (alenileştirme) + md.5/2-f (meşru menfaat) savunulabilir. Kurul 2019/331: alenileştirilen numaranın alenileştirme amacı dışında (sigorta satışı araması) kullanımı ihlal. **AYM 27.01.2026, 2020/32193:** bu cezayı "alenileştirme amacı kanunda düzenlenmemiş" gerekçesiyle kanunilik ilkesine aykırı buldu, yeniden yargılama (ikincil haber; tam metin DOĞRULANMADI) | Risk düştü ama sıfır değil: md.4 ilkeleri (amaçla bağlantılı, ölçülü, gerektiği kadar saklama) ve md.10 aydınlatma geçerli. Minimum veri, saklama süresi, aranmasın, kişisel veri olmayan kanıt |
| Aydınlatma (md.10) | Veri ilgili kişiden toplanmadığında da aydınlatma gerekir (genel kural) | İlk görüşmede sözlü kısa aydınlatma + istenirse ofis aydınlatma metni bağlantısı (vitrin KVKK sayfası); script'te hazır cümle |
| İYS / 6563 | Telefonla pazarlama araması ticari elektronik ileti kapsamında; kural olarak önceden onay; tacir/esnafa istisna ve "ilan sahibini ilanı hakkında arama"nın kapsamı belirsiz (DOĞRULANMADI, hukuki görüş gerekir). Ret hakkı her durumda saklı | Otomatik/toplu arama, SMS, WhatsApp YOK; arama elle; açılışta unvan; ret = anında Aranmasın; kampanyalar FSBO'yu göremez |
| Üçüncü kaynaktan numara bulma | KVKK: numarayı üçüncü kişiden temin edip kaydeden finans şirketine 1 mn TL ceza (2026-07 haberi) | Zenginleştirme YOK; yalnız ilanda görünen numara |
| Taşınmaz Ticareti Yönetmeliği + EİDS | Yetki sözleşmesi yazılı, ≤ 3 ay; EİDS yetkisi olmadan ilan verilemez | Dönüşüm öncesi vitrine/portala YAYIN YOK (sözleşme testi); "yetki alındı" sözleşme + EİDS ister (uyarı, engel değil) |
| Telif | İlan fotoğrafı/metni ilan sahibinin/portalın | Fotoğraf kopyalanmaz; yalnız bağlantı; açıklama metni kaydedilmez |
| Chrome Web Store | Limited Use, tek amaç, en dar izin, gizlilik politikası | `activeTab` (tıklamaya bağlı) tercih; içerik betiği portallara enjekte edilmez |

### f.2 Arayüz metinleri (taslak, Türkçe, kısa)

- **Eklenti "Kaydet" alt notu:** "Yalnız şu an açık olan ilanı ofis kaydınıza eklersiniz. EmlakSoft portalları kendiliğinden taramaz. Telefonu
  yalnız ilanda gördüyseniz ekleyin."
- **Liste üstü kapatılabilir bilgi şeridi (ilk kullanım):** "İlan sahibini arayabilirsiniz; toplu SMS/WhatsApp gönderemezsiniz. Kişi 'aramayın'
  derse 'Aranmasın'a ekleyin — numara ofisinizde bir daha aranmaz. Ulaşamadığınız ve dönüşmeyen kayıtların kişisel bilgileri {N} gün sonra silinir."
- **Aranmasın onayı:** "Bu numara ofisinizin tüm danışmanları için 'aranmasın' olarak işaretlenecek. Numaranın kendisi saklanmaz; yalnız eşleşme için
  şifreli özeti tutulur. Geri almak yalnız yöneticinin yetkisindedir."
- **Script açılışı (sabit):** "Ben {ad}, {ticaret unvanı} adına arıyorum (yetki belge no {no})." + aydınlatma cümlesi: "Numaranızı {portal}'daki
  ilanınızdan aldım; yalnız bu ilanla ilgili görüşmek için kullanıyorum. İsterseniz sizi listemden hemen çıkarırım."
- **Portföye dönüştür uyarısı:** "İlanı yayınlamadan önce yazılı yetkilendirme sözleşmesi (en çok 3 ay) imzalayın ve mal sahibinin sizi
  e-Devlet'te (EİDS) yetkilendirmesini isteyin."
- **v2 yeniden kontrol ayarı:** "Açarsanız eklenti, kayıtlı sahibinden ilanların fiyat ve yayın durumunu günde en fazla bir kez, tarayıcınızda ve
  düşük hızla kontrol eder. Portal bunu kullanım şartlarına aykırı sayabilir; engel görülürse durur. Varsayılan kapalı."

### f.3 Saklama politikası

- Dönüşmeyen kayıt: son etkinlikten **90 gün** sonra (ofis ayarı 30-180) `owner_name`, `phone`, not ve etkinlik notları silinir (`pii_purged_at`);
  ilan bağlantısı, fiyat geçmişi, durum, kayıp nedeni (istatistik) kalır. `kayip/aslinda_emlakci` → yalnız telefon özeti (aranmasın tablosu benzeri) kalır.
- Dönüşen kayıt: kişisel veri müşteri kaydına geçer; müşteri saklama kuralları uygulanır (KVKK silme talebi akışı mevcut `kvkk_requests`).
- Aranmasın: süresiz (yalnız özet); ilgili kişi silme isterse silinir ve bu talebin kendisi kaydedilir.
- AI'ya FSBO verisi gönderilmez (MVP); gönderilirse `redact.ts` zorunlu.

---

## (g) Uygulama adımları ve migration planı

Sıra (her adım küçük commit; test/lint/build yalnız sahip "yap" deyince):

1. **Saf çekirdek** `src/lib/prospecting/`: `types.ts`, `state-machine.ts`, `cadence.ts`, `thresholds.ts`, `relist.ts` (matching.ts skoru
   yeniden kullanılır), `phone-hash.ts`, `retention.ts` + birim testleri.
2. **Migration (forward-only, ayrı dosyalar; son uygulanmış `20261012002220` sonrasına):**
   - `2026101300xx00_prospecting_tables.sql`: `fsbo_leads`, `fsbo_lead_observations`, `fsbo_lead_activities`, `fsbo_do_not_call` + RLS
     (`tenant_id = public.current_tenant_id()`), indeksler, `updated_at` tetikleyicisi, `grant` (authenticated; service_role yazma gerekmez),
     `tasks.fsbo_lead_id` sütunu, tenant tuzu (`tenants` ayarı ya da `platform_settings` — tasarımda karar: `tenant_settings` anahtarı).
   - `2026101300xx10_prospecting_permission_defaults.sql`: `permission_defaults` seed (MATRIX ile birebir).
   - Enum kullanılmıyor (text + CHECK) → 087/087b ayrımı gerekmez.
   - Uygulama öncesi: `npm run check:migrations -- --database` + `npm run db:migrate -- --dry-run`; canlı uygulama sahipte (yedek beyanı mevcut).
     Kod tablo yokken boş duruma düşer (`isMissingSchemaError` deseni) → kod migration'dan önce yayınlanabilir.
3. **Sunucu:** `src/app/actions/prospecting.ts` (kaydet/güncelle/arama sonucu/durum/aranmasın/dönüştür; `requirePermission`, zod, `parsePhoneStrict`,
   `revalidatePath`), `POST /api/app/portfoy-avi/kaydet` (eklenti; oturumlu, idempotent, köken kontrolü mevcut köprü kuralı), okuyucu `load.ts`
   (tek tur, `Promise.all`).
4. **4 kayıt yeri** (e) + modül kayıt defteri + sekme + "+ Yeni" satırı.
5. **UI:** `/app/portfoy-avi/{page,loading,error}.tsx`, detay `[id]`, arama sonucu sheet, script kartı, dönüştür akışı (müşteri + portföy taslağı +
   EİDS/yetki adımı). `src/components/ui` bileşenleri, koyu tema uyumu.
6. **İçgörü kuralları** (d) + facts + `rule-catalog` + kapanış kancası; günlük cron adımı (sahiplik düşmesi, saklama temizliği).
7. **Rapor merkezi** `catalog/` tanımı "Sahibinden ilan hunisi" (kişisel veri kolonu yok) + kapsam sözleşme testi.
8. **Eklenti v0.4:** `activeTab`+`scripting`, açılır pencerede Kaydet, `fsboPending` kuyruğu, adaptörlere FSBO alanları; `build:extension`;
   mağaza metni/gizlilik politikası (sahip).
9. **Sözleşme testleri:** kampanyalar/otomasyon mesaj eylemleri `fsbo_leads`'i hedefleyemez; dönüşmemiş lead vitrine/sitemap'e giremez;
   sunucu kodunda portal hostlarına `fetch` yok (FSBO yolu); `fsbo_leads` sorguları `tenant_id` filtreli; aranmasın kilidi eylemleri engeller.
10. **Demo veri:** `seed:demo`'ya İstanbul örnekleri (Kadıköy, Beşiktaş, Ataşehir; `is_sample=true`, içgörü üretmez, telefonlar kurgusal).
11. **Ölçüm:** liste sorgusu `scripts/perf/measure-live.mts` ile; hedef ilk sayfa tek tur.
12. **v2 adayları:** harita (ilçe kümeleri), Lig/KPI entegrasyonu (`loadLeagueActivity`), ofis düzenlenebilir script, opt-in yeniden kontrol,
    sahibinden resmi veri yolu çıkarsa (Rekabet 2023 kararı yalnız kurumsal üyenin kendi verisi için; FSBO için beklenmez) izleme.

Açık sahip kararları: (1) çağrı merkezi rolü FSBO arayabilsin mi; (2) saklama süresi varsayılanı (90 gün önerisi); (3) v2 otomatik yeniden kontrol
açılsın mı; (4) eklentide iki işlev tek pakette mi, ayrı "İlan Kaydet" eklentisi mi; (5) İYS kapsamı için hukuki görüş alınacak mı (engel değil).

---

## Kaynaklar

Rakipler ve metrikler
- Vulcan7 (resmi): https://www.vulcan7.com/?p=28635 · CloudTalk fiyat: https://www.cloudtalk.io/blog/vulcan7-pricing/ · Capterra: https://www.capterra.com/p/10037867/Vulcan7/
- REDX inceleme (2026-09): https://theclose.com/redx-review/ · FitSmallBusiness: https://fitsmallbusiness.com/redx-review · https://fitsmallbusiness.com/best-fsbo-lead-sources · CloudTalk: https://www.cloudtalk.io/blog/redx-dialer-pricing/
- Landvoice / Espresso: https://www.g2.com/compare/espresso-agent-vs-landvoice · https://wise-agent-crm.groovehq.com/help/landvoice-63527d30 · https://www.toolsforhumans.ai/ai-tools/espresso-agent
- Mojo: https://www.ringover.com/blog/mojo-dialer-pricing · https://theclose.com/mojo-dialer-review · https://justcall.io/hub/cost/mojo-dialer-pricing/
- Karşılaştırma ve metrikler (satıcı içeriği): https://getperspective.ai/blog/best-fsbo-expired-listing-lead-services-2026-compared
- NAR 2025 (ikincil): https://virginiarealtors.org/2025/12/08/key-takeaways-from-nars-2025-profile-of-home-buyers-and-sellers · https://nowbam.com/fsbo-home-sales-are-down-to-a-record-low-5/
- HBR (ilk saat): https://hbr.org/2011/03/the-short-life-of-online-sales-leads
- Takip/script: https://therealestatetrainer.com/what-to-say-when-calling-fsbo-sellers-for-listings/ · https://www.estatepass.ai/tools/fsbo-scripts/guide/ · https://www.cleverly.co/blog/real-estate-cold-calling-scripts

Türkiye
- EmlakCRMx: https://www.capterra.com/p/10043487/EmlakCRMx/ · https://www.hunted.space/product/emlakcrmx
- Apify sahibinden kazıyıcıları (yalnız risk örneği): https://apify.com/clearpath/sahibinden-phone-scraper · https://apify.com/clearpath/sahibinden-real-estate
- Sahibinden'e yaklaşım (2017): https://www.milliyet.com.tr/emlak/sahibinden-satmaya-calisan-mulk-sahiplerinden-portfoy-nasil-alinir-65010
- Şikâyet örnekleri: https://www.sikayetvar.com/sahibinden/sahibindende-emlakci-ilanlari-ve-sikayet-sistemi-sorunu · https://www.haberturk.com/firsatci-emlakciya-ev-sahibinden-tokat-gibi-cevap-yazismalari-ifsa-ederek-sikayetci-oldu-3699774
- EİDS: https://www.milliyet.com.tr/ekonomi/10-soru-10-cevap-iste-emlak-sektorunde-uygulanan-elektronik-ilan-dogrulama-sisteminin-ayrintilari-7217834 · https://www.ntv.com.tr/galeri/ntvpara/10-soruda-emlakta-ilan-dogrulama-zorunlu-hale-geliyor,4cGQereQuE-dLoXJNkKcEQ
- Taşınmaz Ticareti Yönetmeliği (ikincil): https://alomaliye.com/2018/06/05/tasinmaz-ticareti/ · https://alomaliye.com/2020/10/14/tasinmaz-ticareti-hakkinda-yonetmelik-14-10-2020/ · https://www.cnnturk.com/ekonomi/turkiye/emlak-komisyonlarina-yuzde-4-siniri-800389
- BETAM/sahibindex: https://betam.bahcesehir.edu.tr/wp-content/uploads/2024/03/Satilik-Konut-Piyasasi-Gorunumu-Mart2024.pdf

Hukuk
- Rekabet 2023 (40,1 mn TL, veri taşınabilirliği): https://webrazzi.com/2023/08/23/rekabet-kurumu-sahibinden-40-milyon-tl-ceza/ · https://www.ntv.com.tr/ntvpara/sahibinden-coma-40-milyon-lira-ceza,jsuZe6bYcUSuLVVC8BKb4A
- Rekabet 2025 soruşturması (vasıta/Otobid): https://medyascope.tv/2025/02/06/sahibinden-com-hakkinda-sorusturma-acildi-rekabet-kurumu/
- KVKK ihlal bildirimi 2023/504 (sahibinden): https://www.cumhuriyet.com.tr/turkiye/sahibindencomda-veri-sizintisi-iddiasi-kvkk-dogruladi-2066868
- KVKK 2019/331 (alenileştirme amacı): https://www.kvkk.gov.tr/Icerik/6623/2019-331 · https://alomaliye.com/2020/12/17/alenilestirilen-kisisel-verinin-alenilestirme-amaci-disinda-islenmesi/
- AYM 27.01.2026, 2020/32193 (ikincil): https://www.memurlar.net/haber/1170248/anayasa-mahkemesi-kvkk-nin-idari-para-cezasini-iptal-etti.html
- KVKK izinsiz numara temini cezası (2026-07): https://www.evrensel.net/haber/5992253/kvkkden-emsal-karar-izinsiz-sms-atan-sirkete-1-milyon-lira-ceza-kesildi
- Meşru menfaat: https://cottgroup.com/tr/blog/kvkk-gdpr/item/veri-islemede-veri-sorumlusunun-mesru-menfaati
- İYS / 6563: https://cottgroup.com/tr/mevzuat/item/ileti-yonetim-sistemi-ve-yeni-uygulamalar · https://hukukcularevi.com/ticari-elektronik-ileti-iys-izin-6563-reklam/ · https://www.alomaliye.com/2020/01/04/ticari-iletisim-ve-ticari-elektronik-iletiler/
- Chrome Web Store: https://developer.chrome.com/docs/webstore/program-policies/policies · https://developer.chrome.com/docs/webstore/program-policies/limited-use

Kod (salt-okunur incelendi): `docs/HAFIZA.md`, `src/lib/nav-roles.ts` (ILANLAR merkezi), `src/lib/permissions.ts`, `src/lib/billing/page-gates.ts`,
`src/lib/modules/registry.ts`, `src/lib/pool/{server,sources}.ts` (`enqueueListingPool` property_id ister → FSBO kaydı havuza değil, dönüşen portföy
gerekirse havuza), `src/lib/insights/{types,rules/index}.ts`, `src/lib/automation-engine.ts`, `extensions/emlaksoft-ilan-kontrol/**`,
`scripts/build-extension.ts`, `docs/design/ILAN_KONTROL_EKLENTI_TASARIM_2026-10.md`, `supabase/migrations/*` (customers, tasks, calls, iys_consents, insights).
