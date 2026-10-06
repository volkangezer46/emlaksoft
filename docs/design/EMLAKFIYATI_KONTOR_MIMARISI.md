# EmlakSoft ↔ EmlakFiyati: Kontör Mimarisi ve Entegrasyon Şartnamesi

Durum: TASARIM (2026-10-05). Okuyucular: EmlakSoft ekibi (uygulama) ve EmlakFiyati ekibi (karşı taraf sözleşmesi, §6).
İlke: **EmlakSoft kontörün tek yetkilisidir (cüzdan, paket satışı, fiyat, limit). EmlakFiyati veriyi ve belgeyi üretir, kontör TUTMAZ.**

## 1. Roller

| Konu | EmlakSoft | EmlakFiyati |
|---|---|---|
| Kontör cüzdanı (bakiye, geçmiş) | **TEK KAYNAK** (`account_credit_ledger`, birim `ef`) | tutmaz |
| Paket satışı, ödeme (iyzico), fatura | **evet** (Kontör sekmesi + admin) | hayır |
| Sorgu tarifesi (kaç kontör) ve paket fiyatları | **admin tek merkez** | yalnız "bu istek N birim ürettiği" bilgisini döner |
| Kimlik / yetki (hangi ofis, hangi kullanıcı) | oturum + izin kapısı | yalnız opak `tenantRef` görür |
| Veri, endeks, PDF/detay üretimi | çağırır, saklamaz (PDF: kısa ömürlü bağlantı) | **evet** |
| Mutabakat | günlük cron + yönetici ekranı | olay akışı (usage events) sağlar |

## 2. Neden "rezerve → kesinleştir" (ön ödemeli cüzdan, sunucu-sunucu)

Üç model değerlendirildi:
1. **EmlakFiyati kendi bakiyesini tutar** → iki cüzdan, senkron kaybı, çift paket satışı. REDDEDİLDİ.
2. **Aylık faturalama (kullanım sonrası)** → ofis kontör satın almıyor, kontrol kaybı, tahsilat riski. REDDEDİLDİ.
3. **EmlakSoft rezerve eder, EmlakFiyati üretir, EmlakSoft kesinleştirir** → tek cüzdan, atomik, tekrar güvenli. **SEÇİLDİ.**

Kullanıcı tarayıcısı EmlakFiyati'na DOĞRUDAN gitmez (anahtar sızıntısı, kontör atlatma). Tüm çağrılar EmlakSoft sunucusundan geçer;
PDF/detay için EmlakSoft kısa ömürlü imzalı bağlantı ister ve kullanıcıya yönlendirir (veya akıtır).

## 3. Akış (her ücretli sorgu için)

```
Kullanıcı eylemi (ör. "Detaylı rapor + PDF")
 1. İzin kapısı (requirePermission) + ofis kapsamı + günlük/kullanıcı limiti
 2. Tarife: kalem → N kontör (admin tarifesi; ofis özel indirimi varsa o)
 3. RESERVE: ledger'a atomik "rezerve" satırı (idempotency_key = requestId). Bakiye < N → 402-benzeri "yetersiz kontör" + paket önerisi, ÇAĞRI YAPILMAZ
 4. EmlakFiyati çağrısı (sunucu-sunucu, §5 başlıkları, aynı requestId)
 5a. Başarı → COMMIT: rezerve kesinleşir (yanıttaki gerçek `units` ≤ N ise farkı iade; > N ise reddet/uyar)
 5b. Hata/zaman aşımı/boş sonuç → RELEASE: rezerve serbest (bakiye düşmez)
 6. Kullanıcıya sonuç + "X kontör harcandı, kalan Y"
```
Garantiler: (a) **idempotent** (aynı requestId iki kez = tek kesinti); (b) **atomik** (advisory kilit altında bakiye kontrolü + yazım, negatif bakiye YOK);
(c) **sahipsiz rezerve olmaz** (zaman aşımı süpürücüsü 15 dk sonra RELEASE eder); (d) **fail-closed**: cüzdan yazılamıyorsa sorgu YAPILMAZ
(AI kredisindeki fail-open'dan bilinçli fark: burada üçüncü tarafın maliyeti var).

## 4. Veri modeli (EmlakSoft; yeni tablo yok, mevcut tek defter)

Mevcut `account_credit_ledger` (append-only, tenant_id, RLS; AI kredi ve değerleme sayacı bunu kullanıyor) **birim = `ef`** ile genişler:
- Hareket türleri: `grant_purchase` (paket), `grant_plan` (aylık paket-içi dahil kontör), `grant_bonus`, `grant_admin`, `reserve`, `commit`, `release`, `refund`, `expire`.
- Sütunlar (mevcut tasarıma EKLE): `idempotency_key`, `request_ref` (EmlakFiyati tarafı kimliği), `item` (tarife kalemi), `units`, `expires_at` (paket geçerlilik), `meta` (yalnız teknik: rapor kimliği, kalem; **kişisel veri YOK**).
- Bakiye = Σ(grant) − Σ(commit) − Σ(açık reserve) − Σ(expire). Süresi biten paket kontörü FIFO tüketilir (en yakın bitişli önce).
- Plan içi dahil kontör: `plan-definitions` alanı `efCreditsMonthly` (admin düzenler; ay başı TR saati, `trMonth*`).

## 5. Sunucu-sunucu sözleşmesi (EmlakSoft → EmlakFiyati)

> **GÜNCELLEME (2026-10-05): EmlakFiyati ekibinin BİLDİRDİĞİ GERÇEK SÖZLEŞME aşağıdaki öneriyi geçersiz kılar.** Kesin olanlar:
> kimlik yalnız `Authorization: Bearer ek_live_...` (başka başlık yok; `X-ES-Signature`/HMAC imzası, `X-ES-Timestamp`, `X-ES-Tenant-Ref`, `X-ES-Max-Units`
> **kullanılmaz**); ortak uçlar (`/api/ortak/v1/degerleme`, `/api/ortak/v1/rapor/:id.pdf`) için zorunlu başlıklar `X-Ortak-Kullanici-Ref` (takma ref, 8-64
> karakter, `[A-Za-z0-9_.:-]`) ve `Idempotency-Key`; hız sınırı anahtar başına dk'da 120, aşılınca 429 `{"hata":"istek siniri asildi"}` ve **Retry-After yok**;
> kontörü EmlakSoft düşer, EmlakFiyati aylık kullanım dökümü (mutabakat) verir. Ortak uçlar **henüz yok** (yazılıyor): yol/şema/PDF sunumu/yanıtta birim bilgisi
> bekleniyor. `/api/parsel/rapor?format=pdf` kullanıcı ürününde KULLANILMAZ. Aşağıdaki §5 başlık tablosu yalnız **tarihsel öneridir**; §3 akışı (rezerve → üret →
> kesinleştir), §4 cüzdan modeli ve §7 mutabakat ilkeleri geçerli kalır, ama imza/zaman damgası/`X-EF-Units` gibi alanlar EmlakFiyati teyit etmeden uygulanmaz.
> `X-EF-Units` (yanıtta gerçek tüketim) ve kullanım olayları ucu için **doğrulanmadı**: EmlakFiyati'na sorulacak.

Her istek:
```
Authorization: Bearer <EMLAKFIYATI_API_KEY>            # mevcut servis anahtarı (ortam başına ayrı)
X-ES-Request-Id: <uuid>                                # idempotency; AYNI id tekrar gelirse AYNI yanıt, tekrar ÜRETİM/ÜCRET yok
X-ES-Tenant-Ref: <opak, HMAC(tenant_id)>               # ofis kimliği asla açık gitmez; EmlakFiyati yalnız kullanım raporlaması için tutar
X-ES-Timestamp: <unix>                                 # ±300 sn dışı reddedilir
X-ES-Signature: HMAC-SHA256(secret, timestamp.requestId.method.pathAndQuery.bodySha256)   # tekrar/oynama koruması
X-ES-Max-Units: <N>                                    # EmlakSoft'un rezerve ettiği üst sınır; EmlakFiyati bunu AŞAN üretim yapmaz
```
Yanıt başlıkları (zorunlu):
```
X-EF-Units: <gerçek tüketim, tamsayı>                  # EmlakSoft bununla commit eder
X-EF-Request-Ref: <EmlakFiyati kendi kimliği>
X-EF-Idempotent-Replay: true|false
```
İstek gövdesi/sorgusu yalnız **coğrafi yol + ürün tipi (+ rapor/kalem kimliği)** taşır: müşteri adı, telefon, ilan sahibi, ofis adı **GİTMEZ**.

Ürünler ve tarife (varsayılanlar; **admin düzenler**, kodda sabit değil):
| Kalem | Açıklama | Varsayılan kontör |
|---|---|---|
| `endeks_ozet` | bölge medyan TL/m² son dönem | 0 (plan içi ücretsiz; kötüye kullanımı kota sınırlar) |
| `endeks_seri` | 12-36 ay seri + p25/p75 | 1 |
| `detay_rapor` | mahalle/ada detay + emsal özeti | 3 |
| `pdf_rapor` | imzalı PDF indirme | 5 |

PDF/detay: `POST /api/v1/rapor` → `{ raporId, durum }` (aynı requestId ile tekrar güvenli) → `GET /api/v1/rapor/{raporId}/pdf-url` →
**tek kullanımlık, 5 dk ömürlü imzalı URL** (indirme tekrar ücret DOĞURMAZ; ücret üretimde). EmlakSoft URL'i kullanıcıya yönlendirir, kopyasını SAKLAMAZ
(rapor tekrar indirmesi: aynı raporId için ücretsiz yeni URL, belirlenen süre içinde, ör. 30 gün).

## 6. EmlakFiyati ekibinden beklenenler (karşı taraf kontrol listesi)
1. Yukarıdaki başlıkları doğrulamak (imza, zaman damgası, tekrar koruması) ve `X-ES-Max-Units`'i aşmamak.
2. **Idempotency**: aynı `X-ES-Request-Id` ile gelen isteğe aynı yanıt; üretim/ücret tekrarı yok; kayıt ≥ 24 saat.
3. `X-EF-Units` her yanıtta (0 dahil). Hata yanıtlarında `X-EF-Units: 0`.
4. **Kullanım olayları**: `GET /api/v1/usage?since=<ISO>&cursor=` (tenantRef, requestId, kalem, units, zaman, durum) — EmlakSoft günlük mutabakat için çeker (webhook isteğe bağlı).
5. Hata kodları: 400 (geçersiz), 401 (anahtar), 403 (imza/zaman), 404 (veri yok → `X-EF-Units: 0`), 409 (idempotency çakışması), 429 (limit; `Retry-After`), 5xx.
6. Ortam ayrımı: sandbox anahtarı + sahte veri; production anahtarı ayrı ve döndürülebilir (rotasyon: iki anahtar eşzamanlı geçerli).
7. Veri politikası: yalnız coğrafi yol; EmlakFiyati istek günlüklerinde kişisel veri toplamamak; `tenantRef` yalnız kullanım raporlaması.
8. Sağlık/sürüm: `GET /api/v1/health`; sözleşme sürümü başlığı `X-EF-Contract: 1`.

## 7. Mutabakat ve kontrol (EmlakSoft)
- **Günlük cron** (`emlakfiyati-mutabakat`): EmlakFiyati kullanım olaylarını çeker; ledger `commit` kayıtlarıyla requestId bazında eşler. Sapma türleri:
  (i) EmlakFiyati üretti, EmlakSoft kesinleştirmedi → komisyonsuz telafi: **sessiz commit** + uyarı; (ii) EmlakSoft kesti, EmlakFiyati üretmedi → **otomatik iade** (`refund`);
  (iii) units farkı → fark kaydı; hepsi admin "Mutabakat" ekranında tıklanabilir.
- **Süpürücü**: 15 dk'dan eski açık rezerve → `release`.
- **Admin (tek merkez)**: kontör paketleri (ad, kontör, fiyat TL, geçerlilik, bonus, gizli/aktif), tarife (kalem → kontör, ofis özel), plan içi dahil kontör, günlük kullanıcı/ofis limiti,
  düşük bakiye eşiği, ofis bazlı kullanım ve bakiye, manuel `grant_admin` (gerekçeli, denetim kaydı), mutabakat sapmaları.
- **Ofis tarafı**: header/değerleme/bölge analizinde **kontör rozeti** (kalan), "bu işlem N kontör" onayı ücretli kalemlerde, düşük bakiye uyarısı (%20 / 0),
  `/app/abonelik` Kontör sekmesi (paket satın alma = mevcut iyzico akışı, kupon uyumlu), kullanım geçmişi (kullanıcı/kalem/tarih; kişisel veri yok).

## 8. Güvenlik ve KVKK
- Anahtar yalnız sunucu ortam değişkeni; istemciye/loga/ledger'a girmez. İmza sırrı ayrı (`EMLAKFIYATI_SIGNING_SECRET`).
- Kontör kesintisi **yalnız sunucuda**; istemciden tutar/kontör ALINMAZ. Her ücretli eylem `requirePermission` + ofis kapsamı + hız sınırı + denetim kaydı.
- Tenant izolasyonu: ledger RLS (kendi ofisi select), yazım service_role RPC; `tenantRef` tek yönlü HMAC (geri çözülemez).
- PDF URL'leri tek kullanımlık/kısa ömürlü; EmlakSoft kopya tutmaz → KVKK saklama yükü yok.
- Hukuki/KVKK metinleri yer tutucu (ofis/şirket sahibi doldurur).

## 9. Aşamalar
1. **Faz 1 (EmlakSoft tek başına, güvenli):** `ef` birimi + tarife/paket yönetimi + rezerve/kesinleştir/serbest bırak RPC + `getEndeks` sarmalayıcısı (fail-closed) + kontör rozeti + admin ekranları. Endeks özet ücretsiz.
2. **Faz 2 (EmlakFiyati sözleşmeyi karşılayınca):** imzalı istek + idempotency + `X-EF-Units` + kullanım olayları; detay rapor ve PDF; mutabakat cron'u.
3. **Faz 3:** paket-içi aylık dahil kontör, ofis özel tarife, otomatik yeniden yükleme (opsiyonel), toptan mutabakat/faturalama raporu.

## 10. Açık sahip kararları
1. Endeks özeti ücretsiz mi (önerilen: evet, kota ile) yoksa kontörlü mü?  2. Kontör paket fiyatları ve geçerlilik (öneri: 12 ay).
3. Plan içi dahil kontör (öneri: Danışman 0, Ofis 20, Profesyonel 100/ay, Business 300/ay; admin düzenler).
4. EmlakSoft'un EmlakFiyati'na toptan maliyeti (kontör başına) ve marj: mutabakat raporu bunu hesaplar.
5. Süresi biten kontörün iadesi/yenilenmesi politikası (öneri: iade yok, bitiş 30/7 gün önce uyarı).
