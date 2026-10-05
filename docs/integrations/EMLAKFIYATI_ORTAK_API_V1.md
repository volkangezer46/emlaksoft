# emlakfiyati.com Ortak API v1 — Emlaksoft Entegrasyon Kılavuzu (EmlakFiyati ekibinden, KESİN SÜRÜM)

> Kaynak: EmlakFiyati ekibinin ilettiği kılavuz (2026-10-05). Taslak v0'ın (`EMLAKFIYATI_ORTAK_API_TASLAK.md`) YERİNE GEÇER.
> Uç yolları ve alan adları EmlakFiyati sunucu koduyla birebir eşleşir (`src/api/ortak-v1.js`, `src/core/ortak.js`); makine okunur tanım onlarda `docs/openapi-ortak.json`.
> **DOĞRULANMADI (canlı):** 2026-10-05'te Emlaksoft'taki mevcut anahtarla `GET /api/ortak/v1/kullanim` → `403 {"hata":"operator veya admin yetkisi gerekli"}` döndü
> (belgedeki `kapsam_yok`/`ortak_bagi_yok` değil): ortak uçlar canlıda henüz yayında değil VEYA anahtar ortak kapsamlı değil. Ortak uçlar Emlaksoft'ta bir BAYRAKLA kapalı bekler
> ve yalnız başarılı bir canlı yoklamadan sonra açılabilir. Anahtarda `ortak:value` ve/veya `ortak:report` kapsamı ve emlakfiyati.com'da "Emlaksoft" ortak kaydına bağ gerekir.

## 1. Temel bilgiler
| Konu | Değer |
|---|---|
| Taban adres | `https://emlakfiyati.com` |
| Yol öneki | `/api/ortak/v1` |
| Kimlik | `Authorization: Bearer ek_live_XXXX` (yalnız sunucuda) |
| İçerik | JSON UTF-8; PDF ucu `application/pdf` |
| Hata gövdesi | `{ "hata": "<Türkçe açıklama>", "kod": "<makine kodu>" }` (409/422 `anahtar_tekrar_kullanimi` gövdesinde ek `error:{code,message}` olabilir: önce `kod`, yoksa `hata`) |
| İzleme | Her yanıtta `X-Istek-Id` (destek talebinde iletilir; kişisel veri içermez) |
| Önbellek | Tüm yanıtlar `Cache-Control: no-store, private` |

Anahtar YALNIZ Emlaksoft sunucusunda; tarayıcıya/mobil uygulamaya/günlüğe/hata raporuna/git'e yazılmaz; Emlaksoft kullanıcıları emlakfiyati.com'a doğrudan bağlanmaz.
Anahtar kapsamı `ortak:value` (değerleme), `ortak:report` (rapor ve PDF) ya da ikisi; yalnız `/api/ortak/v1/*` içindir; ortağa bağlı değilse `403 ortak_bagi_yok`.

### Zorunlu başlıklar
| Başlık | Uçlar | Kural |
|---|---|---|
| `Authorization` | hepsi | `Bearer ek_live_…` |
| `X-Ortak-Kullanici-Ref` | değerleme, rapor detayı, PDF zorunlu; kullanımda isteğe bağlı | 8-64 karakter, yalnız `A-Z a-z 0-9 _ . : -`; en az bir rakam; bkz. §8 |
| `Idempotency-Key` | yalnız `POST /degerleme`, zorunlu | 8-128 karakter, harf/rakam/`_ . : -`; her yeni değerleme için benzersiz |
| `Content-Type: application/json` | POST | gövde en çok 64 KB |

## 2. Akış
1) Mahalle kimliğini bul (§3.0, anahtarsız referans uçları). 2) `POST /degerleme` → `rapor_id`. 3) `GET /rapor/{rapor_id}` detay, `GET /rapor/{rapor_id}.pdf` PDF. 4) Ay sonu `GET /kullanim` ile mutabakat.

## 3. Uçlar
### 3.0 Mahalle kimliği (anahtar GEREKTİRMEZ; Ortak API sözleşmesinin parçası DEĞİL, sınırsız kullanım garantisi yok: önbelleğe al)
```
GET https://emlakfiyati.com/api/musteri/iller                  -> {"iller":[{"id":1,"ad":"Adana","path":"adana"}, ...]}
GET https://emlakfiyati.com/api/musteri/ilceler?il_id=1        -> {"ilceler":[{"id":84,"ad":"Çukurova","path":"adana/cukurova"}, ...]}
GET https://emlakfiyati.com/api/musteri/mahalleler?ilce_id=84  -> {"mahalleler":[{"id":162,"ad":"Bozcalar","path":"adana/cukurova/bozcalar-mahallesi"}, ...]}
```
Listeler yalnız güncel TKGM mahallelerini içerir; en az birkaç saat önbelleğe al; her kullanıcı tıklamasında yeniden çağırma.

### 3.1 POST /api/ortak/v1/degerleme  (kapsam `ortak:value`; `Idempotency-Key` + `X-Ortak-Kullanici-Ref` zorunlu)
İstek gövdesi:
| Alan | Tür | Zorunlu | Açıklama |
|---|---|---|---|
| `mahalle_id` | tamsayı > 0 | evet | §3.0'dan |
| `ada` | metin | evet | yalnız rakam, 1-12 hane |
| `parsel` | metin | evet | rakam, `/` ve `-`; 1-20 karakter |
| `tip` | `"arsa"` \| `"konut"` | hayır | varsayılan `arsa`; başka değer 422 `gecersiz_tip` |
| `konut_ozellikleri` | nesne | `tip=konut` için | alanlar gövde kökünde de verilebilir |

`konut_ozellikleri` (hepsi isteğe bağlı; konutta ALAN bilgisi şart): `konut_tipi` (`daire` varsayılan | `mustakil` | `bina`), `konut_m2` (ya da `brut_m2`; yoksa 422), `oda_sayi`, `bina_yasi`, `kat`, `kat_toplam`
(aralık dışı 422 `konut_ozelligi_gecersiz`; `kat > kat_toplam` 422 `konut_kat_gecersiz`), `site`/`asansor`/`otopark` (true/false; bilinmiyorsa HİÇ gönderme), `site_adi`/`apartman_adi`/`blok` (en çok 100/100/40 karakter),
`acik_havuz`/`kapali_havuz`/`guvenlik`/`spor_alani`/`akilli_ev` (true).

Örnek: `curl -X POST https://emlakfiyati.com/api/ortak/v1/degerleme -H "Authorization: Bearer ek_live_XXXX" -H "X-Ortak-Kullanici-Ref: u-8f3a91c27d4e4b10" -H "Idempotency-Key: es-20261005-000123-a1" -H "Content-Type: application/json" -d '{"mahalle_id":162,"ada":"101","parsel":"1","tip":"arsa"}'`

**Başarılı (200, `sonuc_durumu:"deger"`)**: K10 MASKELİ sonuç (§6) + `sonuc_durumu`, `ucretlendirilir` (true → kontörü KESİNLEŞTİR), `rapor_id` (UUID), `rapor_url` (`/api/ortak/v1/rapor/{id}`), `pdf_url` (`/api/ortak/v1/rapor/{id}.pdf`),
`rapor_gecerlilik:{gun, expires_at}` (süre dolunca rapor/PDF `404 rapor_yok`). Üst düzey: `tip`, `parsel`, `tahmin`, `fiyat_yayin`, `emsaller`, `konut_ozellikleri`, `harita`, `tespit`, `rapor_gecerlilik`. İç yapı motor çıktısıdır; YENİ ALANLAR eklenebilir (bilinmeyeni yok say).
Kısaltılmış örnek: `{"tip":"arsa","parsel":{"ada":"101","parsel":"1","ilce_ad":"…","alan_m2":"…"},"tahmin":{…},"fiyat_yayin":{"guven_sinifi":"orta",…},"emsaller":{…},"rapor_gecerlilik":{"gun":30,"expires_at":"2026-11-04T09:00:00.000Z"},"sonuc_durumu":"deger","ucretlendirilir":true,"rapor_id":"3f0c2d9e-…","rapor_url":"/api/ortak/v1/rapor/3f0c2d9e-…","pdf_url":"/api/ortak/v1/rapor/3f0c2d9e-….pdf"}`

**Sonuç üretilemedi (200, `sonuc_durumu:"yetersiz"`)** = HATA DEĞİL: `{"sonuc_durumu":"yetersiz","ucretlendirilir":false,"mesaj":"…","nedenler":["deger_yok"],…}`. Rapor oluşmaz, `rapor_id` yok, ÜCRETLENDİRİLMEZ → rezerve edilmiş kontör İADE edilir.

**Hatalar (değerleme)**
| Durum | `kod` | Anlam | Ne yapılır |
|---|---|---|---|
| 400 | `gecersiz_json` | gövde JSON nesnesi değil | düzelt |
| 400 | `idempotency_key_gerekli` / `gecersiz_istek_anahtari` | başlık yok/biçim hatalı | düzelt |
| 401 | `kimlik_gerekli` | anahtar yok/geçersiz/iptal ya da izinli IP listesi dışı | anahtarı ve çıkış IP'sini kontrol et; YENİDEN DENEME YOK; alarm |
| 403 | `kapsam_yok` | anahtarda `ortak:value` yok | destek |
| 403 | `ortak_bagi_yok` / `ortak_pasif` | anahtar ortağa bağlı değil / ortak pasif | destek |
| 413 | `govde_cok_buyuk` | gövde > 64 KB | düzelt |
| 422 | `kullanici_ref_gerekli` / `kullanici_ref_gecersiz` / `kullanici_ref_kisisel_veri` | takma kimlik başlığı eksik/hatalı/kişisel veri gibi | §8 |
| 422 | `gecersiz_girdi`, `gecersiz_tip`, `konut_ozelligi_gecersiz`, `konut_kat_gecersiz`, konut alan eksikliği | girdi hatalı | düzelt; kontör düşme (iade) |
| 422 | `anahtar_tekrar_kullanimi` | aynı `Idempotency-Key` FARKLI gövdeyle | yeni anahtar üret |
| 409 | `istek_isleniyor` | aynı anahtarlı istek hâlâ işleniyor | 2 sn sonra AYNI anahtarla tekrar sor |
| 429 | `istek_siniri`, `esz_degerleme_tavani` | sınır | `Retry-After` kadar bekle |
| 503 | `kademeli_kuyruk` | sistem yoğun (`tekrar_saniye`) | `Retry-After` kadar bekle |
| 4xx/5xx | `veri_yetersiz`, `degerleme_basarisiz` ya da motor kodu | değerleme tamamlanamadı; gövdede `ucretlendirilir:false` | §7 |
Ortak API'de müşteri kotası/ödeme/müşteri ücretlendirmesi YOKTUR; bu hata kodları dönmez.

### 3.2 GET /api/ortak/v1/rapor/{rapor_id}  (kapsam `ortak:report`; `X-Ortak-Kullanici-Ref` zorunlu; rapor kimliği 8-64 karakter harf/rakam/tire)
200: değerleme yanıtının (rapor_id, rapor_url, pdf_url dahil) K10 maskeli kayıtlı özeti. Sayıma girer (`rapor_detay`) ama birim tutarı HER ZAMAN 0.
Hatalar: `404 rapor_yok` (yok/süresi dolmuş/başka ortağın/biçim geçersiz: hepsi aynı), 401/403/422/429. Özet yazılamadıysa (nadir) PDF çalışır ama bu uç `404 rapor_yok` verebilir: PDF'i kullan.

### 3.3 GET /api/ortak/v1/rapor/{rapor_id}.pdf  (kapsam `ortak:report`; `X-Ortak-Kullanici-Ref` zorunlu)
200: `application/pdf`, `Content-Disposition: inline; filename="…"`. PDF pahalıdır: ayrı dakika sınırı (varsayılan 60/dk) ve eşzamanlı üretim tavanı (varsayılan 3).
Aynı raporun ilk PDF'i `pdf`, sonraki indirmeler `pdf_tekrar` sayılır (tekrarın birim tutarı 0) → kullanıcı PDF'i tekrar indirirse yeni kontör düşmez.
| 404 | `rapor_yok` | bulunamadı/süresi doldu/başka ortağın | yeniden değerleme gerekir |
| 429 | `pdf_dakika_siniri`, `esz_pdf_tavani`, `istek_siniri` | sınır | `Retry-After` kadar bekle |
| 503 | `kademeli_kuyruk` | yoğun | `Retry-After` kadar bekle |
| 502 | `pdf_uretilemedi` | üretilemedi (`Retry-After: 10`), ücretlendirilmez | 10 sn sonra en çok 2 kez dene; olmazsa JSON detayı göster |

### 3.4 GET /api/ortak/v1/kullanim  (kapsam `ortak:value` ya da `ortak:report`; `X-Ortak-Kullanici-Ref` isteğe bağlı)
Son 31 günün özeti: `{"ortak":{"kod":"emlaksoft","ad":"Emlaksoft"},"tarife":{"sorgu_tl":0,"pdf_tl":0,"surum":"v1:0:0"},"sinirlar":{"istek_dakika":1200,"pdf_dakika":60,"esz_pdf":3,"esz_degerleme":6},"gun_sayisi":31,
"toplam":{"istek":0,"degerleme":0,"yetersiz":0,"pdf":0,"pdf_tekrar":0,"hata":0,"tutar_tl":0},"gunluk":[{"gun":"2026-10-05","istek":0,"degerleme":0,"yetersiz":0,"pdf":0,"pdf_tekrar":0,"hata":0,"tutar_tl":0}]}`
(sayılar örnektir). `istek` defterdeki TÜM satırlar (değerleme, rapor detayı, PDF, hatalar); ücretlendirilen değerleme sayısı `degerleme`, ilk PDF sayısı `pdf`. `tutar_tl` tarife çarpımı (kardeş firma tarifesi varsayılan 0 TL: sayılır ama ücretsiz).
Günlük kırılım sunucu kayıt saatine göre: ay sonu mutabakatta gün sınırında kayma olabilir.

## 4. Sınırlar
| Sınır | Varsayılan | Aşılınca |
|---|---|---|
| Anahtar başına istek/dk (ortak sınıfı) | 1200 (tavan 10.000) | `429`, gövde `{"hata":"istek siniri asildi"}`, `Retry-After` |
| Ortak başına istek/dk (tüm uçlar) | 1200 | `429 istek_siniri` + `Retry-After` |
| PDF/dk (ortak başına) | 60 | `429 pdf_dakika_siniri` |
| Eşzamanlı PDF | 3 | `429 esz_pdf_tavani` (`Retry-After: 5`) |
| Eşzamanlı değerleme | 6 | `429 esz_degerleme_tavani` (`Retry-After: 3`) |
| İstek gövdesi | 64 KB | `413` |
| `Idempotency-Key` saklama | 24 saat | süre sonunda aynı anahtar yeni istek |
| Rapor geçerliliği | `rapor_gecerlilik.expires_at` (varsayılan 30 gün) | `404 rapor_yok` |
| Ortak başına aktif rapor | 500 (30 günde ~500 başarılı değerleme üstü için EmlakFiyati ayarı gerekir; beklenen hacmi ÖNCEDEN bildir) | yeni değerleme `degerleme_basarisiz` verebilir |
Başarılı yanıtlarda `X-RateLimit-Limit/Remaining/Reset` (epoch sn). Değerler EmlakFiyati'nda yönetilir ve DEĞİŞEBİLİR: SABİT SAYI VARSAYMA; `GET /kullanim` ve başlıklara göre ayarla.

## 5. Yeniden deneme ve geri çekilme
- `429`/`503`: `Retry-After` (sn) kadar bekle; başlık yoksa 5 sn ile başlayıp ikiye katla (en çok 60 sn) + jitter.
- `POST /degerleme` yeniden denemelerinde AYNI `Idempotency-Key` + AYNI gövde: ilk başarılı yanıt aynen döner, `Idempotency-Replayed: true` başlığı gelir; çift sayım/çift rapor oluşmaz. Yalnız 2xx yanıtlar saklanır; 4xx/5xx sonrası aynı anahtarla yeniden deneme işlemi gerçekten yeniden çalıştırır.
- Ağ zaman aşımı: aynı anahtarla yeniden gönder. İSTEMCİ ZAMAN AŞIMI EN AZ 90 SN (değerleme ve PDF).
- `409 istek_isleniyor`: 2 sn bekle, aynı anahtarla sor. `502`/`500`: en çok 2 yeniden deneme (10 sn ve 30 sn arayla), sonra "geçici hata" + kontör İADE. Diğer 4xx: yeniden deneme yok.
- Eşzamanlılığı kendi tarafında sınırla: en çok 3-4 değerleme ve 2 PDF.

## 6. K10 maskeli yanıt ("düşük güven: kesin TL yok")
`fiyat_yayin.guven_sinifi == "dusuk"` ise yanıtta (hiçbir derinlikte) kesin TL tutarı ve birim fiyat (TL/m²) YOK: bu alanlar `null`. Yalnız `fiyat_yayin.guven_sunumu` altındaki yuvarlak aralık ve açıklama metinleri gösterilebilir.
- `null` tutarı 0/"bilinmiyor" diye gösterme; "Düşük güven: kesin TL yok" yaz ve `guven_sunumu` aralığını/metnini göster.
- Değeri kendin hesaplama, eksik alanı tahmin etme, başka kaynaktan doldurma.
- Fiyatlar İLAN fiyatlarına dayanır, gerçekleşen satış fiyatı DEĞİLDİR: arayüzde belirt; "kesin değer", "garanti", "hızlı satış fiyatı" sunumları YAPMA.
- Düşük güvenli sonuç `sonuc_durumu:"deger"` ise yine ÜCRETLENDİRİLİR (rapor üretildi). Ücretlendirilmeyen durum yalnız `yetersiz` ve hatalar.
- Müşteri yüzeyinde kullanılmayan bazı göstergeler (yatırım puanı, hızlı satış/üst fiyat) her durumda `null` olabilir: `null`/bilinmeyen alana bağımlı arayüz kurma.

## 7. Kontör akışı (kontör YALNIZ Emlaksoft'ta tutulur/düşülür; EmlakFiyati yalnız defterine yazar)
1. REZERVE: kullanıcı değerleme/PDF isteyince kontör rezerve edilir (kesinleşmez). Rezerve başarısızsa EmlakFiyati ÇAĞRILMAZ.
2. ÇAĞIR: `POST /degerleme` (benzersiz `Idempotency-Key`; rezerv kaydının kimliğinden türetmek çift düşmeyi kendi tarafta da önler; `X-Ortak-Kullanici-Ref` kullanıcıya özgü).
3. KESİNLEŞTİR/İADE: 200 + `deger` + `ucretlendirilir:true` → kesinleştir (`rapor_id`'yi kullanıcıyla ilişkilendirip sakla). 200 + `yetersiz` → İADE. 4xx/5xx, 429, 503, tüm denemeler başarısız/zaman aşımı → İADE.
   `Idempotency-Replayed: true` yanıtı aynı işlemin tekrarıdır: ikinci kez kesinleştirme (kendi kayıt anahtarınla zaten kesinleşmiş mi bak).
4. PDF: aynı raporun PDF'i için ek kontör ürün kararıdır. Defter ilk PDF'i `pdf` (tarife `pdf_tl`), tekrarları `pdf_tekrar` (0 TL) sayar. ÖNERİ: PDF'i bir kez ücretlendir, tekrar indirmeler ücretsiz. PDF `200` değilse İADE.
5. Rapor detayı (JSON) birim tutarı 0: kontör düşme.
Emin değilsen kontörü tutma: sonuç yanıtı alınamadıysa aynı anahtarla yeniden sorarak durumu netleştir (24 saat içinde); netleşmezse iade et ve aylık mutabakatta defterle karşılaştır.

## 8. KVKK ve takma kullanıcı kimliği
Emlaksoft HİÇBİR kişisel veri göndermez (serbest metin alanlarına — site/apartman adı vb. — ad, telefon, e-posta, TC, adres yazılmaz). `X-Ortak-Kullanici-Ref` kullanıcıyı tanıtmayan TAKMA kimliktir:
- Biçim `^[A-Za-z0-9_.:-]{8,64}$` ve en az bir rakam. Reddedilenler (422 `kullanici_ref_kisisel_veri`): e-posta, Türkiye telefon örüntüsü, geçerli TC kimlik numarası, ad-soyad görünümlü değerler (`ahmet.yilmaz`), rakamsız değerler.
- Öneri: kullanıcı başına rastgele üretilmiş kalıcı kimlik (UUID v4 ya da sunucu tarafı sırla HMAC-SHA256 özetinin ilk 32 hex karakteri). E-posta/telefonun tersine çevrilebilir kodlamasını (base64, hex, kısaltma) KULLANMA.
- EmlakFiyati yalnız takma kimliği, istek kimliğini, ucu, sonucu ve sayımı tutar; ham sorgu içeriği deftere yazılmaz. Eşleme (takma kimlik ↔ gerçek kişi) YALNIZ Emlaksoft'ta; EmlakFiyati ile paylaşılmaz.
- Veri sorumlusu/işleyen rolleri ve saklama süresi EmlakFiyati'nda hukuki incelemededir: SÖZLEŞME İMZALANMADAN canlı kullanıcı verisiyle kullanıma geçilmez.

## 9. Mutabakat
Emlaksoft her çağrının sonucunu (`X-Istek-Id`, `Idempotency-Key`, `rapor_id`, durum, kontör kararı) kayıt altında tutar. Ay sonunda `GET /kullanim` (son 31 gün, günlük kırılım) ile kendi sayımını karşılaştırır: `degerleme` = kesinleşen değerleme sayısı, `pdf` = ücretlendirilen ilk PDF sayısı.
Fark çıkarsa EmlakFiyati kullanım defterinden istek bazlı döküm çıkarır (`X-Istek-Id`'leri destek talebine ekle; konsolda ortak mutabakat sayfası henüz yok). Defter TEK doğruluk kaynağıdır; örneklemeli sayaçlar fatura için kullanılmaz.

## 10. Güvenlik
Anahtar yalnız sunucu ortam değişkeni/gizli yönetim deposunda; günlüğe yazılmaz. **IP izin listesi:** Emlaksoft'un SABİT çıkış IP/CIDR listesi bildirilirse EmlakFiyati anahtara izinli IP tanımlar; liste dışı IP `401 kimlik_gerekli` alır (liste boşsa kısıtlama yok).
Rotasyon: EmlakFiyati personeli yeni anahtar üretir (aynı ortağa bağlı), Emlaksoft geçer, eski iptal edilir; planlı iptalde eski anahtar belirlenen zamana kadar çalışır. Anahtar yalnız oluşturulurken bir kez gösterilir. Sızıntıda derhal bildir, anında iptal edilir. Yalnız HTTPS; sertifika doğrulaması kapatılmaz.
`rapor_id` bir erişim anahtarıdır: herkese açık bağlantı olarak paylaşma; rapor/PDF içeriğini yalnız yetkili oturumda sun.

## 11. Sürüm politikası
Yol öneki `/v1`. Yeni alan/isteğe bağlı başlık sürüm değiştirmez (bilinmeyen alanı yok say). Alan silme/anlam değiştirme/zorunlu başlık ekleme `/v2` ile ve önceden yazılı bildirimle. Sınırlar, tarife ve K10 eşikleri sözleşme dahilinde EmlakFiyati tarafından yönetilir ve sürüm değiştirmeden güncellenebilir (tarife değişince `tarife.surum` değişir).

## 12. Canlıya almadan önce kontrol listesi (EmlakFiyati)
Anahtar yalnız sunucuda ve ortak bağı yapılmış (ilk çağrı `403 ortak_bagi_yok` vermiyor) · her çağrıda `X-Ortak-Kullanici-Ref`, `POST /degerleme`'de benzersiz `Idempotency-Key` · kontör: rezerve, başarıda kesinleştir, `yetersiz`/hata/429'da iade ·
429/503'te `Retry-After`, istemci zaman aşımı ≥ 90 sn · K10: `null` TL "kesin TL yok" · mahalle listeleri önbellekte · ay sonu `GET /kullanim` mutabakatı tanımlı.
