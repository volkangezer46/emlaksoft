# emlakfiyati.com Ortak API — Entegrasyon Kılavuzu (TASLAK v0, EmlakFiyati ekibinden)

> **GEÇERSİZ: bu taslak v0, `EMLAKFIYATI_ORTAK_API_V1.md` (kesin v1) ile DEĞİŞTİRİLDİ. Yalnız tarihsel kayıt.**

> **Durum: TASLAK. Bu kılavuza dayanarak CANLIYA BAĞLANMAYIN** (EmlakFiyati: "anahtar yayın sonrası verilecektir"). Yanıt gövdesi alanları, değerleme girdi şeması,
> hata kodu listesi, PDF sınırları, OpenAPI ve mutabakat dökümü biçimi **KESİNLEŞECEK (v1)**. Emlaksoft tarafında bu uçlar `ORTAK_ENDPOINTS_VERIFIED=false`
> ve bayrak kapalı olarak bekler (`src/lib/integrations/emlakfiyati/ortak.ts`). Kaynak: kullanıcı tarafından 2026-10-05'te iletilen metin; içerik aşağıda özetlenmiş değil, ayrıntı kaybı olmaması için maddeler korunmuştur.

## 1. Amaç ve rol dağılımı
Emlaksoft kullanıcıları emlakfiyati.com'daki değerleme sorgusu, rapor ayrıntısı ve rapor PDF'ine Emlaksoft içinden erişir.
- **Kontör (kredi) Emlaksoft'ta tutulur ve düşülür.** emlakfiyati.com Emlaksoft kullanıcısının kotasını, ödemesini veya kontörünü yönetmez.
- emlakfiyati.com her çağrıyı ortak (Emlaksoft) hesabı altında bir **kullanım defterine** yazar; aylık mutabakat dökümü iki tarafın sayısını eşleştirir.

## 2. Bağlantı
- Taban adres `https://emlakfiyati.com`. Kimlik yalnız `Authorization: Bearer ek_live_…` (`x-api-key` KABUL EDİLMEZ).
- Anahtar yalnız Emlaksoft sunucusunda (tarayıcıya, mobil uygulamaya, loglara, hata mesajlarına, git'e yazılmaz). Arayüz emlakfiyati.com'u doğrudan çağırmaz; Emlaksoft arka ucu aracılık eder.
- UTF-8 JSON (PDF hariç); zaman damgaları UTC ISO-8601.

## 3. Zorunlu başlıklar
| Başlık | Ne zaman | Anlamı |
|---|---|---|
| `Authorization` | her istek | Bearer anahtar |
| `X-Ortak-Kullanici-Ref` | her istek | Emlaksoft son kullanıcısının **takma (rastgele) kimliği**; 8–64 karakter, `[A-Za-z0-9_.:-]`. E-posta/telefon/TC/ad GÖNDERİLMEZ (sistem bu desenleri reddeder). Aynı kullanıcı için hep aynı değer. |
| `Idempotency-Key` | değerleme isteğinde zorunlu, diğerlerinde önerilir | İstek başına benzersiz (UUID). Aynı anahtarla tekrar → aynı yanıt, **defterde ikinci satır yazılmaz**. |

Her yanıtta `X-Istek-Id` döner; destek talebinde bu kimlik iletilir.

## 4. Uçlar (yanıt alanları KESİNLEŞECEK)
- `POST /api/ortak/v1/degerleme` — gövde: ada/parsel (il, ilçe, mahalle, ada, parsel) **veya** adres; şema KESİNLEŞECEK. Yanıt: sonuç özeti + `rapor_id`.
  **Düşük güvenli sonuçlarda kesin TL değeri verilmez** (maskeli; yalnız güven düzeyi ve açıklama). Bu hata değil, ürün davranışıdır. Fiyatlar ilan fiyatlarına dayanır; gerçekleşen satış fiyatı DEĞİLDİR.
- `GET /api/ortak/v1/rapor/{rapor_id}` — yalnız bu ortağın ürettiği rapor; başkasına ait kimlik 404.
- `GET /api/ortak/v1/rapor/{rapor_id}.pdf` — `application/pdf`. PDF pahalıdır: ayrı dakika sınırı ve eşzamanlı üretim tavanı (aşımda 429/503 + `Retry-After`).
- `GET /api/ortak/v1/kullanim` — kendi dönem sayımınız (sorgu sayısı, PDF sayısı, son 31 gün).

## 5. Sınırlar ve hata yönetimi
- Varsayılan sözleşme sınıfı: 1200 istek/dk; PDF için ayrı sınır (varsayılan 60/dk), en çok 3 eşzamanlı PDF (değerler sözleşmeye göre).
- Aşımda **429** + `Retry-After` (saniye) + `X-RateLimit-*`. `Retry-After`'a uyulur; üstel geri çekilme + jitter.
- 401 anahtar geçersiz/iptal (YENİDEN DENEME YOK, alarm). 403 kapsam/ortak bağı yok veya IP izin listesi dışı. 404 kaynak yok/size ait değil. 422 başlık/gövde geçersiz (ör. kullanıcı ref biçimi). 5xx sınırlı yeniden dene (en çok 3, AYNI `Idempotency-Key`).
- Önerilen eşzamanlılık: en çok 4 (PDF için 2). Aynı sorgu sonuçları Emlaksoft'ta önbelleğe alınır (ör. `rapor_id` ile).

## 6. Kontör akışı (EmlakFiyati önerisi; Emlaksoft kontör politikasını kendisi belirler)
1. Emlaksoft kullanıcının kontörünü **rezerve eder**. 2. `Idempotency-Key` üretip çağırır. 3. 2xx → **kesinleştir**; hata/429/zaman aşımı → **iade**; yeniden denemede AYNI `Idempotency-Key`.
4. PDF ayrı işlemdir; kontör politikası Emlaksoft'a aittir (emlakfiyati.com yalnız sayar). 5. Aylık mutabakat: EmlakFiyati dökümü ile Emlaksoft kayıtları `X-Istek-Id`/`Idempotency-Key` ile eşleştirilir.

## 7. Güvenlik
Anahtar rotasyonu: konsolda **Döndür** → yeni anahtar, eskisi 7 gün geçerli. İsteğe bağlı **IP izin listesi** (Emlaksoft'un sabit çıkış IP'si bildirilmeli — **Vercel çıkış IP'leri sabit değildir; bu bir açık konu**). Sızıntıda anahtar hemen iptal edilir (konsol → Ekip → API).

## 8. KVKK
Yalnız mülk bilgisi (ada/parsel/adres/nitelik) ve takma kullanıcı ref gönderilir. Defterde ada/parsel ve takma ref saklanır, kişisel veri saklanmaz. Veri işleyen/sorumlu rolleri ve saklama süresi sözleşmeyle netleşecek (hukuki inceleme bekliyor).

## 9. Sürümleme
Uçlar `/v1/` altında. Geriye uyumlu eklemeler (yeni alan) bildirimsiz olabilir; kırıcı değişiklik `/v2/` ile önceden duyurulur. İstemci bilinmeyen alanları yok sayar.

## 10. KESİNLEŞECEKLER (v1'e kadar)
Yanıt gövdesi alanları, değerleme girdi şeması, hata kodu listesi (`hata`, `kod`), PDF boyut/süre sınırları, OpenAPI tanımı, örnek curl çıktıları, mutabakat dökümü biçimi, canlı sözleşme sınıfı değerleri.

---
## Emlaksoft notları (bu belgenin parçası değildir)
- **Mevcut `/api/endeks` vs ortak API farkı:** `/api/endeks` (endeks serisi) için 429'da `Retry-After` YOKTU (önceki bildirim); ortak uçlarda VAR. Adaptör `Retry-After` varsa ona uymalı, yoksa kendi geri çekilmesini kullanmalı.
- **Yanıt başlığı `X-Istek-Id`** hata/destek kayıtlarında (kişisel veri içermeyen) saklanmalı; adaptörde henüz yok.
- **Kontör mimarisi** (`docs/design/EMLAKFIYATI_KONTOR_MIMARISI.md`): §3 rezerve→kesinleştir akışı bu kılavuzun §6 önerisiyle örtüşür; `X-ES-*` imza başlıkları GEÇERSİZDİR.
- **IP izin listesi:** Vercel sabit çıkış IP'si vermez; izin listesi kullanılacaksa sabit çıkış (ör. Vercel Static IPs eklentisi veya ara vekil) gerekir — karar sahibinde.
- PDF akışı kullanıcıya akıtılırken `Content-Disposition` ve boyut sınırı ve "kontör sonra, PDF önce üretildi mi" sırası (rezerve → üret → kesinleştir) KESİNLEŞMEDEN yazılmaz.
