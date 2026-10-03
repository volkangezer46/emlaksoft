# Persona: Müşteri (alıcı, kiracı, ev sahibi/satıcı)

Rol: tüketici deneyimi araştırması. Yöntem: kod envanteri (statik). Canlı portal Playwright değerlendirmesi YAPILMADI (kapsam dışı bırakıldı); aşağıdaki mobil yorumlar kod okumasına dayanır, ölçüm değildir.
Tarih: 2026-10-03. Durum etiketleri: VAR (dosya) / KISMEN / YOK / MÜKERRER.

## 0. Envanter (müşteriye dönük yüzeyler)

| Yüzey | Dosya | Not |
|---|---|---|
| Vitrin (liste, detay, favoriler, değerleme) | `src/app/vitrin/[slug]/**` | Kayıtlı arama (`saved-search-box`), fiyat alarmı (`price-alert-form`), alım hesaplayıcı, yatırım paneli, "Evim ne kadar eder" (`degerleme`) |
| Müşteri portalı | `src/app/musteri-portali/[token]/page.tsx` | Eşleşen portföy kartı (kapak, %skor, vitrin linki), beğen/geç (`match-feedback`), karşılaştırma, arayışlar (salt okunur), yaklaşan randevu + takvime ekle, danışmana ara/WhatsApp, alt sabit iletişim çubuğu |
| Malik portalı | `src/app/malik-portali/[token]/page.tsx` | Liste fiyatı, yayın sayısı/durumu, gelen teklifler + kabul/ret (`offer-actions`), liste fiyatı geçmişi, randevular, danışman iletişimi |
| Randevu teyit | `src/app/randevu-teyit/[token]` | "Geliyorum / Katılamayacağım" (iptal eder) |
| Randevu al | `src/app/randevu-al/[token]` | Müşteri slot seçer |
| E-imza | `src/app/imza/[token]` (+ `_lib/sms.ts`) | SMS OTP, yazdır |
| Ödeme linki | `src/app/odeme-link/[token]` | iyzico, süre sayacı |
| Değerleme raporu | `src/app/degerleme-raporu/[token]` | Müşteriye gönderilen rapor |
| Sunum / paylaş | `src/app/sunum/[token]`, `src/app/paylas/[token]` | Portföy sunumu / paylaşım (açılış bildirimi: `paylas` page.tsx:196) |
| Anket / tavsiye / açık ev | `anket/[token]`, `tavsiye/[token]`, `acik-ev-kayit/[token]`, `lead/[token]` | Memnuniyet, referans, giriş formu |
| Ortak çatı | `src/components/public/portal-kit.tsx`, `token-page.tsx` | KVKK aydınlatma bağlantısı alt notta |
| Token yaşam döngüsü | `src/app/actions/customer-portal.ts`, `owner-portal.ts` | `expires_at`; iptal = süreyi "şimdi"ye çekmek |
| Ofis tarafı (müşteri görmez) | `app/kiralama/[id]` (arıza paneli, tahakkuk), `app/aidat`, `app/sozlesmeler`, `app/teklifler` | Kiracı/arıza/aidat verisi sadece personelde |
| Otomasyon | `src/lib/automation-engine.ts`, cron `randevu-hatirlat`, `vitrin-eslesme`, `vitrin-alarm`, `kira-tahakkuk`, `haftalik-ozet` | WhatsApp serbest metin bilinçli kapalı (şablon sözleşmesi); `haftalik-ozet` YALNIZ ofis yöneticisine |

## 1. Yolculuk A: alıcı / kiracı

| Adım | Karşılık | Durum |
|---|---|---|
| Aradığını tarif etme | Vitrin kayıtlı arama (`saved-search-box`), `lead/[token]`; portalda arayış salt okunur | KISMEN (portaldan düzenlenemez) |
| Eşleşen ilanlar + favori | Portal kartları, beğen/geç, karşılaştır; vitrin favoriler | VAR (iki ayrı favori/beğeni kavramı: vitrin favorisi vs portal beğeni — bağlantısı doğrulanmadı) |
| Yeni eşleşme bildirimi | cron `vitrin-eslesme`, `vitrin-alarm` | VAR |
| Randevu alma | `randevu-al/[token]` | VAR |
| Randevu erteleme | teyit sayfasında yalnız iptal; "yeni tarih için ofisi arayın" metni | YOK (en büyük sürtünme) |
| Yer gösterme sonrası görüş | `anket` memnuniyet anketi (anlaşma sonrası); gösterim sonrası "beğendim/neden olmadı" yok | KISMEN |
| Teklif verme / durumunu görme | Alıcı tarafında teklif formu YOK (vitrin detayında teklif akışı bulunamadı, portalda yok); durum yalnız malikte | YOK |
| Sözleşme / imza | `imza/[token]` SMS OTP | VAR |
| Kiracı: ödeme/aidat takibi | `kira-tahakkuk` cron + `app/aidat` ofis içi; kiracıya dönük görünüm yok. `odeme-link` tek seferlik ödeme | KISMEN |
| Kiracı: arıza bildirimi | `app/kiralama/[id]/maintenance-panel` yalnız personel girer | YOK (kiracı tarafı) |

## 2. Yolculuk B: ev sahibi / satıcı

| Adım | Karşılık | Durum |
|---|---|---|
| Portföy durumu: gösterim/randevu/teklif | Malik portalı randevu + teklif sayıları | VAR |
| Teklife karar | `offer-actions` kabul/ret | VAR (karşı teklif malik tarafından verilemiyor mu: doğrulanmadı) |
| Gösterim sonrası alıcı geri bildirimi | Maliğe gösterilmiyor | YOK |
| Fiyat önerisi / emsal | Ofiste değerleme/emsal motoru; malik portalında yok. Fiyat geçmişi VAR | KISMEN |
| İlan görünürlüğü / portal durumu | "Portal Yayınları" (durum, tarih, dış link) | VAR. Görüntülenme/tıklama sayısı YOK (ilan no teyidi var, scrape yok bilinçli) |
| Haftalık özet | `haftalik-ozet` cron yönetici içindir; malike gitmiyor | YOK (malik için) |
| Belge / yetki sözleşmesi | `sozlesmeler` ofis içi; malik portalında belge/yetki görünümü yok | YOK |
| Komisyon şeffaflığı | `app/komisyon` ofis içi; malike gösterim yok | YOK |
| Kira tahsilat raporu | `kira-tahakkuk`, aidat ofis içi; malik raporu yok | YOK |

## 3. Ortak

| Konu | Durum |
|---|---|
| KVKK aydınlatma | VAR (portal alt notu, `portal-kit.tsx:159`) |
| İletişim tercihi (kanal, sessiz saat, durdur) | KISMEN: ofis tarafı `app/uyum` + İYS formu var; müşterinin kendi seçtiği kanal/vazgeç bağlantısı portalda YOK |
| Tek bağlantı portal | MÜKERRER/bölünmüş: müşteri ve malik ayrı token, ayrı sayfa; aynı kişi hem malik hem alıcıysa iki link |
| Token güvenliği | VAR: `expires_at`, iptal, `noindex`, tenant aktiflik kontrolü |
| Mobil | Sayfalar tek sütun, max-w-3xl, müşteri portalında alt sabit iletişim çubuğu; malik portalında bu çubuk YOK (`PortalContactBar` kullanmıyor) |
| Tutarlılık | Malik portalı `portal-kit` bileşenlerini (`PortalInvalidLink`, `PortalSection`, `PortalFooterNote`) kullanmıyor, kendi kopyalarını yazmış (mükerrer UI) |

## (a) En değerli 12 geliştirme

Değer/efor: Y/O/D. Migration: M=var, -=yok.

| # | Geliştirme | Değer | Efor | Mükerrer riski | Migration |
|---|---|---|---|---|---|
| 1 | Randevu teyit sayfasına "Başka zaman öner" (slot seçtir, `randevu-al` slot mantığını yeniden kullan; iptal yerine erteleme talebi) | Y | O | Orta: `booking-public.ts` ile ortak kullan | - (appointments güncellenir) veya küçük M (talep durumu) |
| 2 | Malik portalına haftalık özet (gösterim, randevu, teklif, fiyat değişimi); `haftalik-ozet` deseni, WhatsApp şablonu/SMS/e-posta, ofis onaylı gönderim | Y | O | Düşük (yöneticiye giden özetin malik sürümü) | - (mevcut veriden) ; gönderim kaydı için M olabilir |
| 3 | Gösterim sonrası geri bildirim: randevu bitince müşteriye tek dokunuşlu "ilgi / fiyat / konum / olmadı" linki; sonuç malik portalında anonim özet | Y | O | Orta: `anket` + `match-feedback` ile birleştir | M (geri bildirim alanı yoksa) |
| 4 | Müşteri portalından alıcı teklifi ("teklif ver") + durum izleme; ofis `teklifler` modülüne düşer, `offer_rounds` kullanılır | Y | Y | Orta: `offers.ts` | - (muhtemelen); token'dan teklif kaynağı alanı için M |
| 5 | Arayışı portaldan düzenle (bütçe, oda, bölge) ve "bu eşleşme neden" gerekçesi | Y | O | Düşük | - |
| 6 | Müşteri iletişim tercihi sayfası (kanal, sessiz saat, "bilgilendirmeyi durdur") portal alt notundan; İYS/`uyum` ile senkron | Y | O | Orta: `app/uyum` | M (müşteri bazlı tercih alanı) |
| 7 | Malik portalında "Fiyat ve piyasa": emsal özeti ve ofisin onayladığı fiyat önerisi (değerleme motoru çıktısı, onay butonu ofiste) | Y | O | Orta: değerleme raporu ile | - |
| 8 | Kiracı portalı (yeni token türü değil, müşteri portalına bölüm): aylık borç/ödendi durumu, `odeme-link` ile öde, arıza bildir (maintenance kaydı açar) | Y | Y | Yüksek: `kiralama`, `aidat`, `odeme-link` | M (kiracı kimliği/token kapsamı, arıza kaynağı) |
| 9 | Malik için kira tahsilat raporu (tahakkuk, ödenen, geciken, kesinti) | Y | O | Orta: `kira-tahakkuk` | - |
| 10 | Malik portalında belgeler ve yetki sözleşmesi durumu (imzalı/süre sonu), yenileme hatırlatması | O | O | Orta: `sozlesmeler` | - |
| 11 | Komisyon şeffaflığı kartı: anlaşılan oran, KDV dahil/hariç, hesap örneği (yalnız sözleşmedeki gerçek oran, tahmin yok) | O | D | Düşük | - |
| 12 | Malik portalını `portal-kit` + `PortalContactBar`'a taşı (tutarlılık, mobil sabit çağrı) | O | D | Bu bir mükerrer temizliğidir | - |

Öncelik önerisi: 12 (hızlı), 1, 2, 3, 6, sonra 4, 5, 8.

## (b) Portal birleştirme / sadeleştirme

1. Tek müşteri portalı: kişi başına tek token, kapsamı roller belirler (alıcı, malik, kiracı bölümleri). Aynı kişinin malik + alıcı olması gerçek sık durumdur (sat-al). Mevcut iki token tablosu (`customer_portal_tokens`, `owner_portal_tokens`) korunup önce "müşteri portalı malik bölümünü, kişinin sahibi olduğu portföyler için gösterir" olarak köprülenebilir; geriye uyum için eski `/malik-portali` linkleri yönlendirme ile yaşar. Risk: malik portalı portföy bazlı (property_id), müşteri portalı kişi bazlı; veri modeli farkı için M gerekebilir.
2. Ortak çatıya geç: malik portalı `portal-kit` kullanmalı (başlık, geçersiz link, bölüm, alt not, sabit çubuk). Sıfır işlevsel risk.
3. Randevu işlemleri tek yerde: `randevu-teyit` + `randevu-al` + portal "Yaklaşan randevular" aynı bileşenden (teyit, ertele, iptal, takvime ekle) beslenmeli.
4. Tek "gönder" akışı: danışman portal linkini WhatsApp şablonuyla tek tıkla göndersin (otomasyon şablonu zorunluluğuna uygun).
5. Tekil amaçlı tokenlar (imza, ödeme, anket, tavsiye, açık ev) bağımsız kalmalı; portal bunlara "bekleyen işlemler" olarak link versin (ör. "İmzanızı bekleyen 1 sözleşme").

## (c) Güven ve şeffaflık unsurları (yalnız kodda doğrulanabilenler)

- Linkler süreli ve ofis tarafından iptal edilebilir (`expires_at`), arama motorlarına kapalı (`robots noindex`).
- Malik portalı yalnız liste fiyatını gösterir, minimum/gizli fiyat sızmaz (page.tsx yorumu ve sorgu `price_field = list_price`).
- Anket sayfası müşteri adı ve anlaşma detayını bilinçli göstermez.
- Danışman butonları danışmana gider, müşterinin kendi numarasına değil.
- İmza SMS OTP ile; sözleşme yazdırılabilir.
- KVKK aydınlatma bağlantısı portal alt notunda; kişi verisi AI'ya maskeli gider (`redact.ts`).
- İlan yayın durumu "teyit" mantığıyla (ilan no/URL; scrape yok) gösterilir; "yayında" ifadesi ofisin teyidine dayanır.
- Eklenebilir (kodda altyapısı var): "son güncelleme zamanı" damgası, kim ne zaman teklif kabul etti kaydı (audit log var), ofisin lisans/yetki belgesi numarası (veri alanı yoksa M).

## (d) Doğrulanamayan veya dikkat edilmesi gereken iddialar

- `docs/OZELLIK_MASTER_LISTESI.md` satır 121-146 portalların "zayıf" olduğunu söyler; satır 275 ise v2'nin tamamlandığını yazar. Kod v2'yi doğruluyor (kartlar tıklanabilir, beğen/geç, danışman iletişimi); eski satırlar eskimiş.
- Aynı belge "randevu onayı yok" diyor; teyit sayfası var, ancak erteleme yok (bu belge).
- "Deploy YAPILMADI" notu eski; CLAUDE.md canlıda diyor. Hangisinin güncel olduğu bu çalışmada doğrulanmadı.
- Vitrin detayında alıcı teklifi olmadığı yalnız `teklif` kelimesi aramasıyla çıkarıldı; sayfa tam okunmadı.
- Karşı teklifin malik portalından verilip verilemediği doğrulanmadı.
- Müşteri portalında favori ile vitrin favorisinin bağlı olup olmadığı doğrulanmadı.
- Mobil (390px) görünümü canlıda ölçülmedi; "mobil iyi" iddiası yapılmadı.
- Dış kaynaklı rakamlar (portal görüntülenme, "ortalama yanıt süresi" vb.) EmlakSoft'ta üretilmediği için sahte skor riski: bu tür metrik veri kaynağı olmadan eklenmemeli (CLAUDE.md sahte skor yasağı).
