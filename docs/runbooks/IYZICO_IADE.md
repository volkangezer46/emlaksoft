# iyzico iade ve ödeme mutabakatı (runbook)

Amaç: para iadesinin EmlakSoft kayıtlarıyla (fatura, kontör, hesap kredisi, referans ödülü) tutarlı yapılması ve bekleyen/şüpheli tahsilatların günlük yakalanması.
Kapsam: yalnız süper admin (`billing` platform modülü; iade yazan eylemler süper admin ister). Kart verisi EmlakSoft'ta tutulmaz; tüm kart işlemleri iyzico panelindedir.

## 1. İlke: iade OTOMATİK DEĞİLDİR

- EmlakSoft iyzico'ya iade isteği GÖNDERMEZ. Para iadesi **iyzico panelinde elle** yapılır; EmlakSoft yalnız o iadenin KAYDINI düşer ve bağlı kredileri geri alır.
- Sıra önemlidir: önce iyzico'da iade, sonra EmlakSoft'ta kayıt. Kayıt düşülünce kontör/kredi geri alma (clawback) otomatik çalışır; para tarafı geri alınamaz.
- Tek kaynak kod: `recordInvoiceRefund` ve `resolveCapture` (`src/app/actions/platform-billing.ts`), ekran `/admin/billing` (fatura satırı "iade kaydı", mutabakat kuyruğu "İade edildi").

## 2. Adım adım: ödenmiş faturaya iade

1. **Kararı ve tutarı belirle.** Brüt (KDV dahil) tutar, tam ya da kısmi. Fatura `paid` ve TRY olmalı; aynı faturaya İKİNCİ iade kaydı düşülmez (`meta.refund` varsa sistem "zaten kaydedilmiş" der). Kısmi iade tek seferdir: tutarı baştan doğru gir.
2. **Faturadaki ödeme dağılımını oku.** `/app/abonelik/fatura/<id>` (ya da `/admin/billing` fatura satırı) "Hesap kredisi: X ₺ / Kart: Y ₺" gösterir. Kart payı iyzico'dan, hesap kredisi payı EmlakSoft'ta geri yazılır:
   iade tutarı ÖNCE kart (nakit) kısmından düşer, artan kısım krediye geri yazılır (harcanan krediyi aşamaz). Tamamı hesap kredisiyle ödenen faturada iyzico'da yapılacak bir şey yoktur.
3. **iyzico panelinde iadeyi yap.** iyzico merchant panelinde ilgili işlemi (fatura `iyzico_payment_id` = ödeme referansı; faturada "Ödeme referansı" olarak görünür) bul, KART payı kadar iade/iptal et. İade numarasını/referansını not al. (Aynı gün içindeki işlem için "iptal", sonrası için "iade" seçeneği panelde değişir; iyzico ekranını izle.)
4. **EmlakSoft'ta iade kaydını düş.** `/admin/billing` > fatura > "İade kaydı": tutar (brüt) + neden (en az 3 karakter; iyzico iade no'sunu yaz). Sistem sırayla:
   - kontör paketi faturasıysa verilen EF kontörü geri alır (kontör KULLANILMIŞSA bakiye yetmez ve kayıt ENGELLENİR: tutarı düşürüp tekrar dene ya da elle değerlendir; idem anahtarı aynı olduğundan tekrar çift düşmez);
   - hesap kredisi kullanılmışsa payını geri yazar (`try_credit_refund_invoice`; başarısızsa kayıt DÜŞÜLMEZ, aynı işlemi tekrar et);
   - son olarak `meta.refund = {amount_try, reason, at}` yazar ve denetim kaydı (`logPlatformActivity`) bırakır.
5. **Referans/ortak ödülü etkisi.** İade edilen fatura davet edilen ofisin İLK GERÇEK ödemesiyse bağlı referans talebi `reversed` olur ve verilmiş TL kredi clawback edilir (bakiye eksiye düşebilir, eksi bakiye harcanamaz). `growth-claims` cron'u kaçırılan iadeleri de yakalar. Kontrol: `/admin/growth` talep kuyruğu ve ofisin kredi hareketleri.
6. **Doğrula.** Fatura detayında iade görünür; `/admin/muhasebe` iade kartı ve defter (durum "iade") güncellenir; muhasebeci CSV'sinde "İade Tutarı" dolu olur. Ofis kredisi/kontör bakiyesi beklenen değerde mi bak.
7. **Muhasebe/vergi:** iade belgesi (iade/gider pusulası, e-fatura iptal/iade) EmlakSoft'ta üretilmez; mali müşavire iletilir.

Yarım kalma durumları:
- iyzico'da iade yapıldı ama EmlakSoft kaydı düşülmedi: adım 4'ü tekrarla (idempotent). Kayıt düşülmeden fatura "tahsil edilmiş" görünür; muhasebe farkı oluşur.
- EmlakSoft kaydı düşüldü ama iyzico iadesi yapılmadı: KAYIT geri alınamaz; iyzico'da iadeyi hemen yap, aksi halde müşteri iade görünür ama para gelmez.

> İzleme: `manual_review` günlük kontrolü ve uptime/cron alarmları için bkz. `docs/runbooks/IZLEME.md`.

## 3. Tahsilat mutabakatı: `billing_payment_captures`

iyzico'da tahsil edilmiş ama EmlakSoft'a işlenememiş ödemeler `billing_payment_captures` tablosunda izlenir (cron `billing-reconciliation`, her 10 dk). Durumlar:

| Durum | Anlam | Ne yapılır |
|---|---|---|
| `captured_pending` / `retry_pending` | işlenmeyi/yeniden denemeyi bekliyor | Cron halleder; 1 saatten uzun kalıyorsa nedenini (son hata kodu) incele |
| `manual_review` | otomatik işlenemedi, insan kararı bekliyor | Faturayı/tenant'ı incele: (a) düzeltilebiliyorsa "İncelemeye al" notuyla çöz; (b) paranın iadesi gerekiyorsa "İade gerekli olarak işaretle" |
| `refund_required` | para sağlayıcıda duruyor, EmlakSoft işleyemiyor (ör. kredi rezervi serbest kalmış, süresi geçmiş fatura) | §2 adımlarıyla iyzico'da iade et, sonra kuyrukta "İade edildi olarak kapat" (iade referansı zorunlu, geri alınamaz) |

### 3.1 Günlük kontrol (her iş günü, sabah)
1. `/admin/billing` > **Ödeme uyarıları** kartı: `Manuel inceleme` ve `İade gerekiyor` sayıları. İkisi de 0 olmalı. Sayıya tıklayınca mutabakat kuyruğu o duruma süzülür (`?odeme=manual_review|refund_required`).
2. Sıfır değilse: her kayıt için tutar, tenant, `last_error_code` ve deneme sayısına bak; aynı gün karara bağla (iade ya da düzeltme). `refund_required` kayıtları müşterinin parasının bizde/iyzico'da askıda durması demektir: AYNI GÜN kapatılması hedeftir.
3. Karar ve iyzico iade referansı kuyruktaki not alanına yazılır (denetim kaydına girer).

### 3.2 Cron kaçırma kontrolü
- `/admin/sistem`: `billing-reconciliation` (10 dk), `dunning` (günlük), `growth-claims` (günlük 06:40 TR), `ef-kontor-sweep` (10 dk) heartbeat'leri. Beklenen sıklığın 2 katından eski heartbeat = cron kaçmış demektir.
- Kaçmışsa: Vercel > Cron Jobs günlüğüne ve `CRON_SECRET` değerine bak (yanlış/eski secret 401 üretir), gerekirse deploy sonrası doğrulama komutlarını (DEPLOY.md §4, `cron:smoke -- --auth-only`) koş. `cron:smoke` argümansız veri DEĞİŞTİRİR: yalnız onaylı doğrulamada.
- Reconciliation uzun süre çalışmazsa tahsil edilmiş ödemeler `captured_pending`'de birikir; müşteri ödeme yaptığı halde planı açılmamış görünür. Önce cron'u düzelt, sonra kuyruğun eridiğini doğrula.

### 3.3 Dış uptime izleyici (öneri; henüz kurulu DEĞİL)
Vercel cron kaçırma ve site kesintisi EmlakSoft içinden görülemez. Önerilen: dış servisle (UptimeRobot/Better Stack/Healthchecks benzeri) 
- `GET /api/health` her 1-5 dk (200 + `status=ready`; ayrıntı için `HEALTHCHECK_SECRET` Bearer'ı sızdırmadan);
- e-posta + SMS/telefon bildirimi, iki farklı kişiye;
- (opsiyonel) heartbeat tabanlı "dead man's switch": `billing-reconciliation` her başarılı koşuda dış servise ping atacak şekilde ileride eklenebilir (şu an yok; eklenirse `recordHeartbeat` yanına ve `check:cron` sözleşmesine uygun yazılmalı).
Kurulduğunda bu bölüme servis adı ve alarm alıcıları yazılır.

## 4. Hesap kredisi düzeltmeleri
Ofise elle hesap kredisi yükleme/geri alma için admin ekranı YOK (TL kredi RPC'leri service_role ister; kayıtlı bir admin-client yolu bulunmuyor — karar: `docs/HAFIZA.md` §3). Acil düzeltme gerekirse sahibe/geliştiriciye iletilir; defter append-only olduğundan düzeltme her zaman yeni bir satırdır (grant/reverse), eski satır silinmez.

## 5. Kontrol listesi (tek bakış)
- [ ] iyzico panelinde iade yapıldı, referans alındı
- [ ] `/admin/billing` iade kaydı düşüldü (neden + referans)
- [ ] Kontör/kredi geri alma sonucu doğrulandı (hata varsa aynı işlem tekrarlandı)
- [ ] Referans ödülü varsa `reversed` ve clawback görüldü
- [ ] Muhasebe/mali müşavire iade belgesi bildirildi
- [ ] Ödeme uyarıları kartı 0/0
