# Özellik Araştırması — Ekim 2026 (piyasa + mevzuat + mevcut ürün)

Tarih: 2026-10-06 · Kapsam: YALNIZ araştırma ve önceliklendirme; kod/migration değiştirilmedi, test/build koşulmadı.
Kural: "uydurma değil kanıta bağlı". Her iddianın yanında kaynak işareti var. Hukuki danışmanlık DEĞİLDİR; mevzuat satırları "doğrulanmalı".
Bu belge `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` (F1-F7, 2026-10-04), `FEATURE_BACKLOG.md`, `RESEARCH_TR_CRM.md`, `RESEARCH_GLOBAL_CRM.md` ve `PANEL_KARAR_1.md` içindekileri TEKRAR önermez; onlara atıf yapar.
Önceki belgelerden bu yana ürüne giren F1 (MASAK kayıt defteri `uyum/kayit-defteri`), F2 (doğal dil arama `src/lib/nl-search`), F3 (foto kalite `src/lib/photo-quality`), F4 (evrak linki `src/app/evrak`, `src/lib/doc-request`), F5 (mahalle notu) "VAR" sayıldı.

Kaynak işareti: **[A]** sayfa gerçekten açıldı (içerik fetch ile okundu; ikincil/haber sayfası olabilir) · **[S]** yalnız arama sonucu özeti · **[X]** açılamadı (403/engel), doğrulanamadı · **[B]** önceki repo belgesinden devralındı (orada [A]).
Resmî metin (Resmî Gazete, TKGM, Ticaret Bakanlığı) bu çalışmada DOĞRUDAN açılamadı; mevzuat kaynaklarının çoğu hukuk bürosu/haber sayfasıdır → kanıt güveni 2 (ikincil) sayıldı.

Öncelik skoru (şeffaf, sahte kesinlik yok): **Skor = Değer(1-5) × Kanıt(1-3) ÷ Efor(S=1, S-M=1,5, M=2, L=4)**; harici anahtar/sözleşme gerektirenlerde ×0,5 (hemen yapılamaz).
Kanıt: 3 = ürün/resmî sayfa açıldı ve tek başına yeterli · 2 = ikincil kaynak ya da tek kaynak · 1 = yalnız arama özeti/zayıf. Değer = kullanıcı sayısı × sıklık × para/risk etkisi (YARGI; ölçülmüş kullanım verisi YOK, VARSAYIM).

---

## 1. Özet

1. Piyasa taraması: sahibinden "Emlak Pro 2.0" (23.02.2026) [A], Emlakjet+Endeksa dönüşümü (Şub. 2026; EmlakZeka, Temmuz 2026) [A], Hepsiemlak çok dilli ilan [S], Türk CRM'ler (RE-OS, Arveya, PortföyCRM, KiraPratik) [A/B], global (Follow Up Boss, Zillow AI mode, BoldTrail, Pipedrive/HubSpot) [A/S].
2. Ürünün omurgası piyasayla büyük ölçüde örtüşüyor; "eksik" yazılanların çoğu zaten VAR (Akıllı Liste, takip planı = `playbooks`, aday hızı, çağrı özeti, doğal dil arama, foto kalite, yer gösterme tutanağı, kira tahakkuk + TÜFE radarı, ters eşleştirme bildirimi). Bölüm 3'te dosya kanıtıyla.
3. EN ZAMANA DUYARLI bulgu: **taşınmaz satışında Güvenli Ödeme Sistemi** (Taşınmaz Ticareti Yönetmeliği değişikliği, RG 29.04.2026/33238; zorunluluk tarihi **1 Aralık 2026'ya ertelendi**, Ticaret Bakanlığı açıklaması 28.09.2026 [A]) ve **EİDS satılık konut yetki doğrulaması + taşınmaz kimlik numarası** (15.02.2026 itibarıyla; e-Devlet yetkisi en az 3 ay [A]). Ürün ikisine de hazır DEĞİL (grep kanıtı §3).
4. Hemen uygulanabilir (harici anahtar/sözleşme yok) 7 madde, harici gerektiren 3 öncelikli madde seçildi (§5). Ürünün "doğru ve dürüst" çizgisi korunur: para ürün içinden GEÇMEZ, resmî sistemler kazınmaz.
5. Doğrulanamayan/çelişkili: GÖS tarihi kaynaklarda 1 Ekim/1 Aralık karışık (en yeni 1 Aralık), tapu döner sermaye tutarı üç farklı değer, TÜFE Ekim 2026 değeri yalnız ikincil kaynakta (§7). Bunlar KODA SABİTLENMEZ; ayar + doğrulama tarihi + kaynak ile.

---

## 2. Kaynaklar (kullanılanlar)

| # | Konu | Bulgu | Kaynak |
|---|---|---|---|
| K1 | sahibinden Emlak Pro 2.0 (23.02.2026) | 4 ürün (Pro, Pro Plus, Pro Premium, Premium Plus Ofis); Premium Görünüm, Premium Plus Ofis Vitrini, Üst Sıradayım Dopingi, **Metin Düzenleme (AI ilan metni)**, **Bana Emlakçı Bul** (mal sahibi ↔ emlakçı) | https://www.turkiyeajansi.com/yasam/emlak-ofisleri-icin-cok-daha-guclu-bir-dijital-magaza-deneyimi-484311h [A] · https://www.gayrimenkulhaber.com/sektorden-gelismeler/sahibinden-comun-profesyonel-emlak-ofisi-urunleri-yenilendi/ [A] |
| K2 | sahibinden Pro uygulaması | Özet ekranı: görüntülenme, mesaj sayısı, 24 saatlik ziyaret, favori raporu, **piyasa ve rakip analizi**, fiyat değişim takibi (portal içi veri; bizde yok, kazıma yasak) | https://apps.apple.com/cy/app/sahibinden-pro/id1536917817?l=tr [A] |
| K3 | Emlakjet + Endeksa | Şubat 2026 birleşme; EmlakZeka (doğal dil asistan), ilan detayında değer aralığı/kira getirisi/yatırım skoru/5 yıllık fiyat grafiği (Temmuz 2026 haberi); fotoğraftan ilan başlığı/metin üretimi [S] | https://egirisim.com/2026/07/25/emlakjet-yapay-zeka-ile-kullanicilarinin-karar-vermesini-kolaylastiracak/ [A] · https://www.aa.com.tr/tr/isdunyasi/gayrimenkul/emlakjetten-yapay-zeka-destekli-emlak-asistani/703328 [S] |
| K4 | Hepsiemlak | Türkçe ilanların otomatik EN/RU yayını (blog, ikincil) | https://www.armagankocabas.com/post/gayrimenkulde-yapay-zeka-2026-turkiye-emlakcisinin-dijital-asistan-rehberi [S] |
| K5 | RE-OS / Arveya / PortföyCRM / EmlakCRMx / Reonix | Çok dilli ilan, MLS havuzu, arayan tanıma, AI çağrı özeti, teklif görüntülenme sinyali, otomatik PDF sunum | `RESEARCH_TR_CRM.md` [B]; https://re-os.com/entegrasyonlar [B] |
| K6 | Arveya Kira Takip | Beklenen/tahsil/geciken ödeme, kısmi ödeme, sözleşme + yenileme tarihi, **malik hesabı ayrımı (kiracı ödemesi / gider / malike ödeme)**, TÜFE artışı, banka hareketi eşleştirme, CSV içe aktarma; "tahsilatı garanti etmez" notu | https://www.arveya.com/kira-takip [A] |
| K7 | KiraPratik | Kiracıya SMS davet, ödeme hatırlatma, gecikme yönetimi (çok kanal), otomatik kira artışı, kiracı gider onayı → sonraki kiradan düşme, 8 bankadan otomatik ödeme talimatı, kredi kartıyla ödeme | https://www.kirapratik.com.tr/nasil [A] |
| K8 | Follow Up Boss AI | Smart Summaries (beta), Smart Messages, Suggested Tasks, Predictive Lead Prioritization, Smart Actions (beta); otonom AI sesli arama/otonom SMS YOK (3. parti) | https://followupace.com/blog/follow-up-boss-ai-tools-complete-guide [A, ikincil] |
| K9 | Zillow AI mode (25.03.2026) | Konuşma biçiminde arama, tur planlama, ajana bağlanma | `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` §1 [B]; https://www.zillow.com/news/zillow-debuts-ai-mode/ [S] |
| K10 | AI sesli asistan (global) | Gelen arama karşılama, geri arama, nitelendirme, randevu; "insan devri" kalıbı. Satıcı blogları; "3,4x dönüşüm" gibi rakamlar KULLANILMAZ | https://www.retellai.com/blog/ai-voice-agent-for-real-estate [S] |
| K11 | BoldTrail (kvCORE), Pipedrive/HubSpot | Davranışsal kampanya, AI öncelik; Pipedrive kanban + "deal rotting" göstergesi (genel CRM) | https://www.getapp.com/real-estate-property-software/a/kvcore/ [S] · https://nuacom.com/pipedrive-vs-hubspot-complete-crm-comparison-guide/ [S] |
| K12 | **Güvenli Ödeme Sistemi (GÖS)** | RG 29.04.2026/33238: nakit/havale/EFT ile ödenen taşınmaz satışında bedel satıcıya doğrudan değil, tescille eş zamanlı güvenli ödeme sistemi üzerinden; alıcı tapu randevusu öncesi bedeli bloke hesaba yatırır, tescilde satıcıya aktarılır; kredili kısım hariç; danışman hizmet bedeli sistem dışı; **zorunluluk 1 Temmuz → 1 Ekim → 1 Aralık 2026** (Bakanlık açıklaması 28.09.2026) | https://paksoy.av.tr/2026/05/tasinmaz-satislarinda-guvenli-odeme-sistemi-zorunlu-hale-geliyor/ [A] · https://www.gzt.com/ekonomi/tasinmaz-satislarinda-guvenli-odeme-sistemi-1-aralik-2026ya-ertelendi-4264876 [A] · https://www.gayrimenkulhaber.com/guncel/tapuda-once-para-mi-once-imza-mi-donemi-sona-eriyor/ [A] |
| K13 | **EİDS** | Kimlik doğrulama 01.11.2023, yetki doğrulama 15.09.2024, kiralık 01.01.2025, satılık konut 15.02.2026 (haber); mal sahibi e-Devlet "EİDS Yetki İşlemleri"nde emlak işletmesinin yetki belgesi no'sunu girer, yetki en az 3 ay (sahibi uzatır), **Taşınmaz Kimlik Numarası** üretilir ve portallarda kullanılır; tek emlak işletmesi yetkilendirilebilir (haber); yetki kalkarsa ilan yayından kalkar; sosyal medya (Instagram/Facebook) platformları da kapsamda; platforma 10.000-100.000 TL idari para cezası | https://www.trtv.net/2026/09/25/konut-satisinda-e-devlet-yetkilendirme-sistemi/ [A] · https://acarergonen.av.tr/tr/yayinlar/duyurular/tasinmaz-ilanlarinda-elektronik-kimlik-ve-yetki-dogrulamasina-iliskin-bilgi-notu [A]; `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` §1 (ticaret.gov.tr) [B] |
| K14 | Değerli Konut Vergisi 2026 | Eşik 17.711.000 TL; 17.711.000-26.567.000 aşan kısım %0,3; 26.567.000-35.425.000: 26.568 TL + fazlası %0,6; üstü: 79.716 TL + fazlası %1,0; Emlak Vergisi Kanunu Genel Tebliği Seri 88 (RG 31.12.2025/33124 5. mükerrer) | https://www.alomaliye.com/2025/12/31/emlak-vergisi-kanunu-genel-tebligi-seri-no-88-2026-degerli-konut-vergisi/ [A] |
| K15 | Değer artış kazancı 2026 | Edinmeden 5 yıl dolmadan satışta gelir vergisi; 2026 yıllık istisna 150.000 TL; 5 yıl sonra vergisiz | https://musavirlerkulubu.com.tr/makale/2026-yili-gayrimenkullerin-5-yil-icinde-satisinda-gelir-vergisi-beyani-rehberi [S] |
| K16 | Tapu harcı 2026 | Alıcı binde 20 + satıcı binde 20 (üç kaynak aynı); **döner sermaye tutarı kaynaklar arasında ÇELİŞKİLİ**: 6.681 TL [S] / 2.534 ve 6.988 TL [A] / kodda 6.000 TL | https://ayboga.av.tr/tapu-harci-hesaplama-programi/ [A, çelişkili] |
| K17 | Kira artışı | TBK m.344: yenileme aylarının bir önceki ayına ait TÜFE 12 aylık ortalaması; Ekim 2026 için %31,49 (TÜİK 05.10.2026 verisi; hukuk bürosu özeti) | https://ayboga.av.tr/kira-artis-orani/ [S] |
| K18 | Yabancıya satış / ikamet | Taşınmaz yoluyla ikamet izni: 16.10.2023 sonrası edinimlerde 200.000 USD (önceki 75.000/50.000), SPK lisanslı ekspertiz raporu 3 ay geçerli; vatandaşlık 400.000 USD + 3 yıl şerh; kişi başı 30 ha | https://www.kllegalconsultancy.com/articles/tasinmaz-yoluyla-ikamet-izninde-200000-dolar-siniri-2026-yilinda-yeni-kurallar-ve-ekspertiz-raporu [A] |
| K19 | e-imza / Dijital Kontrat | e-Devlet "Dijital Kontrat – Kira Sözleşmesi" (zorunlu değil; mobil/e-imza/çipli kimlik ile) [A]; kira sözleşmesi, yetki belgesi, danışmanlık sözleşmesi e-imza ile yapılabilir, taşınmaz devri/resmî şekil gerektirenler yapılamaz (ikincil) | https://www.avukatoguzhankalkan.com/e-devlet-kira-sozlesmesi/ [A] · https://emlakcrmx.com/blog/emlak-sozlesmesinde-e-imza-2026-kurulum [A] |
| K20 | WhatsApp Business fiyat/politika | Mesaj başına şablon ücreti; müşteri hizmet penceresinde şablon dışı mesaj ve (pencere içi) utility şablon ücretsiz; Türkiye utility/auth oranı 01.01.2026'da düştü (resmî sayfa). Marketing ≈ 0,011-0,0125 USD/mesaj rakamı yalnız 3. parti özet [S]; açık uçlu genel amaçlı AI bot yasağı [B] | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing [A] · https://respond.io/blog/whatsapp-general-purpose-chatbots-ban [B] |
| K21 | Instagram yayın API | Profesyonel hesap + Sayfa + Page Publishing Authorization + izin/uygulama incelemesi; JPEG, Reels, carousel (10'a kadar); 24 saatte 100 API gönderisi | https://developers.facebook.com/docs/instagram-platform/content-publishing/ [A] |
| K22 | Sanal staging yayın etiketi | ABD/California AB 723 (01.01.2026) ve ARMLS (28.05.2026) dijital değiştirilmiş görseli etiketlemeyi zorunlu kılıyor. TÜRKİYE'de portal/yasal çerçeve DOĞRULANAMADI | https://armls.com/virtually-staged-photos [S] |
| K23 | Deprem/yapı bilgisi | AFAD TDTH koordinat/adres sorgusu e-Devlet girişi ister (programatik API bulunamadı); e-Devlet "Riskli Yapı Sorgulama" [S]; Enerji Kimlik Belgesi 2020'den beri satış/kiralamada zorunlu [S] | https://tr.euronews.com/2025/04/26/turkiye-deprem-risk-haritasi-rehberi-istanbullular-sokaginin-durumunu-nasil-ogrenebilir [S] · https://hukukcularevi.com/binalarda-enerji-kimlik-belgesi-ekb/ [S] |
| K24 | sahibinden ilan kuralları | Başlık/açıklamada reklam, link; fotoğrafta logo/telefon/başka site yok (arama özeti; sayfa 403) | https://www.sahibinden.com/sozlesmeler/ilan-verme-kurallari-48 [X] |
| K25 | Portal veri aktarımı | Rekabet Kurulu 26.06.2025: sahibinden kurumsal üye ilanları için API; üçüncü taraf CRM erişimi DEĞİL, veri taşınabilirliği | https://www.mfylegal.av.tr/haberler/sahibinden-api-veri-tasima-karari-26-06-2025/ [B] |

---

## 3. Mevcut ürün karşılaştırması (VAR / KISMEN / YOK; dosya kanıtı)

Yöntem: nav-config, `src/app/app/**`, `src/app/actions/**`, `src/lib/**` grep/okuma (2026-10-06, HEAD `2ca5cd39`). "YOK" yalnız grep'te iz bulunmayana yazıldı.

### 3.1 Türkiye'ye özgü kritik ihtiyaçlar (görevin 3. maddesi)

| İhtiyaç | Durum | Kanıt | Boşluk |
|---|---|---|---|
| WhatsApp iletişim | KISMEN | Giden: `sendWhatsAppTemplateWithConfig` (yalnız ŞABLON), `tenant-providers.ts` `sendTenantWhatsApp`; gelen: `src/app/api/webhooks/meta/route.ts` (imzalı), `gelen-kutusu/inbox-view.tsx`; elle: `wa-template-menu.tsx` (wa.me); `integrations/registry.ts` whatsapp durumu hesaba bağlı | Pencere içi serbest metin cevap, sohbet iş parçacığı yok; hesap (Meta WABA) gerekli |
| e-imza / e-sözleşme | KISMEN | SMS OTP `src/app/imza/[token]`, `otp-hmac.ts`, `actions/contracts.ts` (`requestSignatureOtp`/`verifySignatureOtp`), sözleşme versiyon/şablon; yer gösterme tutanağı randevudan (`randevular/page.tsx:590`) | Nitelikli/mobil e-imza ve e-Devlet Dijital Kontrat YOK (K8 sahip kararı); "güvenli e-imza" iddiası kodda yok (doğru) |
| Kira TÜFE ve yaşam döngüsü | VAR (büyük ölçüde) | `src/lib/tufe.ts` + admin tablo `/admin/ayarlar/tufe`; `kiralama/page.tsx` yenileme radarı (60 gün); `kira-artis` sayfası; `actions/rentals.ts` (oluştur/uzat/bitir/depozito iadesi/`applyRentIncrease`/`createRentCharge`/`toggleChargePaid`/bakım talebi); cron `kira-tahakkuk` (tahakkuk, 7 gün gecikme → ofis bildirimi, yenileme bildirimi) | (a) KİRACIYA hatırlatma yok (cron yalnız ofise yazar); (b) kiralama ↔ sözleşme bağı yok (`rental_id` contracts'ta yok); (c) malik ekstresi yok; (d) kısmi ödeme/ödeme bildirimi yok |
| Tapu harcı / KDV / yatırım | VAR (alıcı tarafı) | `src/lib/purchase-costs.ts` (harç, KDV, DASK, ekspertiz, kredi masrafı), `hesaplayici`, `investment.ts` (emlak vergisi binde 1/2) | Satıcı tarafı (değer artışı, net eline geçen), Değerli Konut Vergisi YOK (grep boş); sabitler koda gömülü (`docs/MEVZUAT_SABITLERI.md`: hepsi DOĞRULANAMADI, döner sermaye 6.000 çelişkili) |
| Deprem risk / yapı bilgisi | KISMEN | `features.building_age` (`properties.ts:93`), DASK maliyet satırı, `deal-checklist-templates.ts:23` "Enerji kimlik belgesi", `foreign-sale-checklist.ts:38` DASK | Riskli yapı sorgusu/AFAD bağlantısı/EKB sınıfı alanı yok; AFAD için API yok (e-Devlet girişi) |
| Kentsel dönüşüm | YOK (yalnız etiket) | yalnız `definition-defaults.ts:134` ("Kentsel dönüşüm" seçeneği) | Süreç/hak sahipliği modeli yok; hukuki karmaşıklık yüksek → ERTELE |
| Yabancıya satış | VAR | `/app/yabanci-satis`, `foreign-sale-checklist.ts` (16 madde + 8 kart), `actions/foreign-sale.ts` | Ekspertiz/vatandaşlık/kota var; **ikamet izni 200.000 USD eşiği kartı yok**, **GÖS maddesi yok** (K12/K18) |
| ilan metni (Sahibinden/Hepsiemlak) | VAR | `src/lib/listing-text.ts` (portal limitleri "tahmin" notlu), `ai/content.ts` (`listing`), `portfoyler/[id]/ai-content-panel.tsx` | Çok dilli çeviri YOK (grep `çeviri/translate` boş); portal kural doğrulaması yok (K24 [X]) |
| Sosyal medya (Instagram) içerik | KISMEN | `ContentKind` = `listing/whatsapp/social/email` (`ai/content.ts:8`, `social` metni Instagram/Facebook); `lib/brand/og-card.tsx`, `lib/vitrin-og.tsx` (next/og) | Paylaşım KARTI (görsel) üretimi yok; otomatik yayın yok (K21 harici) |
| Ofis içi arz-talep eşleştirme bildirimi | VAR | `src/lib/match-notify.ts` (yeni portföy → eşleşen talepler → danışmana bildirim+push), cron `vitrin-eslesme`, `vitrin-alarm`, `matching.ts` ağırlıklar; `talepler?sekme=eslesme` | — (müşteriye otomatik WhatsApp gönderimi bilerek yok) |
| EİDS / yetki takibi | KISMEN | `properties.authorization_start/end/type` (`property-management.ts:76`), 60/30/7 gün `license.ts`, `authority-shield.ts`, `listing-control/health-score.ts:50` ("EİDS / yetki belge bilgisi" ölçülemiyor) | **Taşınmaz Kimlik Numarası alanı YOK** (grep `eids_no/tasinmaz_no` boş); yetki 3 ay mantığı/uyarısı yok |
| Güvenli Ödeme Sistemi (GÖS) | YOK | `grep "güvenli ödeme"` yalnız faturalama (iyzico) dosyalarında | Anlaşma/kapora akışında adım, bilgi kartı, uyarı yok |

### 3.2 Piyasa özellikleri (rakip → bizde)

| Rakip özelliği | Durum | Kanıt |
|---|---|---|
| FUB Smart Lists / KW SmartPlans (takip planı) | VAR | `/app/akilli-listeler`, `playbooks.ts` + `playbook-templates.ts` |
| FUB lead routing (round robin, kural) | VAR | cron `havuz-atama`, `src/lib/pool/score.ts`, atama kuralı migration'ları |
| FUB Predictive Prioritization / AI öncelik | VAR | `customer-heat.ts`, `lead-score.ts`, `insights/` (ana ekran kapısı) |
| FUB Smart Summaries / Arveya AI çağrı özeti | VAR (metinden) | `ai/call-summary.ts`; ses→metin YOK (K5 sahip kararı) |
| Zillow AI mode / Emlakjet EmlakZeka | VAR (ofis içi + vitrin yarım) | `src/lib/nl-search`, `arama-sonuclari/nl-panel.tsx` |
| Speed-to-lead (aday hızı) | VAR | `raporlar/lead-hizi`, `src/lib/response-time` |
| Pipedrive deal rotting | KISMEN | `lost-sale-detector.ts`, `deal-score.ts`, `kayip-satis` (risk altındaki müşteriler); pano kartında "bekliyor gün" rozeti doğrulanmadı |
| Arveya teklif görüntülenme sinyali | VAR | `paylas/[token]/page.tsx:157-197` (`view_count`, ilk açılışta bildirim) |
| RE-OS arayan tanıma / CTI | YOK (K6 dış santral) | `FEATURE_BACKLOG` G6 |
| RE-OS çok portal dağıtımı / sahibinden API | YOK (iskelet) | `integrations/portals/index.ts`, K25 |
| sahibinden Metin Düzenleme (AI) | VAR | `ai/content.ts` |
| sahibinden Bana Emlakçı Bul | VAR (karşılığı) | public "Evim ne kadar eder" + `/lead` (sahip adayı toplar) |
| sahibinden/Emlakjet ilan performansı (görüntülenme/favori) | YOK (portal verisi; kazıma YASAK) | `ROADMAP` kuralı; yalnız ofisin kendi vitrin verisi |
| Dijital kartvizit (QR) | VAR | `ekip/kartvizitim` |
| Mülk yönetimi: gider/bakım | KISMEN | `maintenance_requests`, `kiralama/[id]/maintenance-panel.tsx`; kiracı gider onayı/malik ekstresi yok |
| Referans ağı (eXp global referral, ReferralExchange) | VAR (TR ağ) | `ag`, `tavsiyeler`, `referrals`; yurt dışı referans komisyon payı YOK (ERTELE) |

---

## 4. Özellik kartları

Format: değer · rakip/mevzuat kanıtı · mevcut durum · efor · risk · skor · plan (dosyalar, migration).
Ortak kural: `docs/HAFIZA.md` §5/§7 (yeni klasör/dosya, tek satır entegrasyon, forward-only migration, `check:migrations`, `createAdminClient` yok, OpenAI yalnız `openai-client.ts`, zaman `clock.ts`, telefon/e-posta tek merkez, sıfır çıkmaz metrik).

### A. HEMEN UYGULANABİLİR (harici anahtar/sözleşme gerektirmez)

**H1. Güvenli Ödeme Sistemi (GÖS) hazırlığı — anlaşma/kapora akışında adım + bilgi kartı**
- Değer: 5 (ofislerin tamamı; zorunluluk 1 Aralık 2026, yaklaşık 8 hafta; yanlış yönlendirme ofise ceza/itibar riski). Kanıt: K12 (3 sayfa [A], hepsi ikincil) → 2. Mevcut: YOK (§3.1). Efor: S. Risk: hukuki (metin/tarih değişebilir), para ürün içinden GEÇMEZ (lisans). **Skor 10,0.**
- Ne: (1) Satış anlaşması kontrol listesine maddeler: "Alıcı/satıcı kişisel TL IBAN'ı güvenli ödeme sistemine tanımlandı", "Bedel güvenli hesapta bloke (tapu randevusundan önce)", "Kredili kısım ayrı", "Hizmet bedeli GÖS dışı (K12 [A])"; (2) `Uyum` sayfasında kaynaklı/son-doğrulama-tarihli bilgi kartı; (3) randevu türü "Tapu işlemi" (tapu randevusu GÖS adımından sonra, K12); (4) zorunluluk tarihi koda SABİT yazılmaz: `platform_settings` anahtarı + "doğrulama tarihi" (TÜFE tablosu kalıbı). Satışta kapora/aracılık sözleşme şablonlarına GÖS maddesi AVUKAT ONAYI sonrası (yer tutucu).
- Dosyalar: `src/lib/deal-checklist-templates.ts` (satış şablonu), `src/app/app/uyum/page.tsx` (kart), `src/lib/definition-defaults.ts` (randevu tipi; tanım tek-kaynak testleri), `src/app/app/anlasmalar/[id]/deal-costs-section.tsx` (tek satır uyarı), `docs/MEVZUAT_SABITLERI.md` (satır). Migration: YOK (platform_settings var).
- Kabul: tarih "ayarlı/doğrulama tarihi" etiketli; "ödeme sistemimizden geçer" ifadesi hiçbir yerde yok; hukuki danışmanlık değildir notu.

**H2. EİDS Taşınmaz Kimlik Numarası + yetki (≥3 ay) takibi**
- Değer: 5 (satılık konutta yetki doğrulaması 15.02.2026'dan beri; no yoksa ilan yayınlanamaz — K13). Kanıt: 2 (trtv + hukuk bürosu [A], ticaret.gov.tr [B]). Mevcut: KISMEN (yetki tarihleri var, no YOK). Efor: S-M. Risk: düşük (elle giriş, "resmî doğrulama değildir"); numara biçimi DOĞRULANAMADI → yalnız trim/uzunluk. **Skor 6,7.**
- Ne: portföyde "EİDS taşınmaz no" alanı; yetki bitişine 15/7/3 gün uyarı (yetki en az 3 ay olduğundan kısa pencereler; `license.ts` 60/30/7 kalıbından ayrı); ilan kontrol sağlık skorunda `eids` girdisi ÖLÇÜLEBİLİR olur (şu an "ölçülemedi", `health-score.ts:50`); Portal Kontrol'de "EİDS no eksik" süzgeci; ilan metni/sosyal kartına no eklenir (K13: sosyal medya kapsamda); "tek yetkili işletme" uyarısı yalnız bilgi notu (haber [A] ama resmî teyit yok).
- Dosyalar: yeni migration `supabase/migrations/<2026082600xxxx>_property_eids_no.sql` (+rollback; `properties.eids_property_no text`, mevcut RLS yeter), `src/app/actions/properties.ts`, `src/app/app/portfoyler/yeni/property-tabs.ts`, `portfoyler/[id]/sections.tsx` (yetki bölümü satır ~362-400), `src/app/actions/property-management.ts`, `src/lib/listing-control/health-score.ts` + `server/sync.ts`, `src/app/app/portallar/page.tsx` (süzgeç; URL↔sunucu filtre kontratı). Mükerrer: `authority-shield.ts` ve ilan-kontrol "eids" metriği TEK alana bağlanır (BIRLESTIR).
- Kabul: sıfır çıkmaz (uyarı sayısı filtreli listeye gider), migration forward-only, `db:rls-audit` temiz.

**H3. Kiracıya kira hatırlatma (kapalı doğar; wa.me + opsiyonel SMS)**
- Değer: 4 (kira takibi yoğun TR ofislerinin günlük işi; gecikme = ofis/malik şikâyeti). Kanıt: 3 (KiraPratik, Arveya sayfaları [A]). Mevcut: KISMEN (cron yalnız ofise bildirir). Efor: M. Risk: orta — kiracı iletişimi işlem iletisi mi ticari ileti mi (İYS) AVUKAT teyidi; rıza/tercih. **Skor 6,0.**
- Ne: Aşama 1 (sıfır dış bağımlılık): kiralama listesinde/ayrıntıda "Hatırlat" = hazır WhatsApp metni (wa.me, mevcut `wa-template-menu.tsx` kalıbı) + görev; Aşama 2: ofis ayarıyla (varsayılan KAPALI) vadeden 3 gün önce / vade günü / +3 gün gecikmede SMS, yalnız ofisin kendi Netgsm hesabı bağlıysa (`sendTenantSms`; hesap yoksa "etkin değil" gösterir). Idempotans `notify-dedupe.ts` kalıbı; yeni cron EKLENMEZ (36 sayısı korunur), `kira-tahakkuk` genişler.
- Dosyalar: `src/app/api/cron/kira-tahakkuk/route.ts`, `src/lib/messaging/tenant-providers.ts` (yalnız kullanım), `src/lib/message-templates.ts`, `src/app/app/kiralama/[id]/charges-panel.tsx`, ofis ayarı `oversight_settings.thresholds` JSON'u (Insight kalıbı, HAFIZA §13; migration YOK, doğrulanmalı); gerekirse tek kolon `rent_charges.last_reminded_at`.
- Kabul: kapalıyken hiçbir mesaj gitmez; kiracı telefonu `parsePhoneStrict`; gövdede kişisel veri/tutar dışında ek bilgi yok; cron 60 sn / 2000 satır sınırı (mevcut `limit(2000)` korunur, sayfalı).

**H4. Çok dilli ilan metni (EN / RU / DE / AR)**
- Değer: 3 (yabancıya satış yapan kıyı/İstanbul ofisleri; mevcut `/app/yabanci-satis` modülüyle sinerji). Kanıt: 2 (RE-OS [B], Hepsiemlak [S], Emlakjet fotoğraftan metin [S]). Mevcut: YOK. Efor: S. Risk: düşük (metin; PII yok). **Skor 6,0.**
- Ne: `ai-content-panel`'de dil seçici; çıktı düzenlenebilir taslak; rakam/ölçü/EİDS no korunur (`narrative-guard.ts` sayı doğrulama kalıbı); AI kredi ölçümü (`src/lib/ai/credits`) mevcut hattan.
- Dosyalar: `src/lib/ai/content.ts` (veya yeni `ai/translate.ts`), `src/app/actions/ai-content.ts`, `portfoyler/[id]/ai-content-panel.tsx`; yalnız `openai-client.ts` + `redact.ts`. Migration YOK.
- Kabul: model çıktısı sayı eşleşmesi testi; kaynak dil Türkçe etiketi; "AI çevirisi — kontrol edin" notu.

**H5. Yabancıya satış modülü güncellemesi (ikamet eşiği + GÖS)**
- Değer: 3. Kanıt: 2 (K18 [A], K12). Mevcut: VAR ama bayat/eksik. Efor: S. Risk: hukuki (doğrulanmalı etiketi mevcut). **Skor 6,0.**
- Ne: `FOREIGN_SALE_GUIDE`'a "İkamet izni: 200.000 USD (16.10.2023 sonrası edinim; SPK ekspertiz 3 ay)" kartı; checklist'e GÖS maddesi (H1 ile aynı metin tek kaynaktan); mevcut kartların "son doğrulama tarihi" alanı. BIRLESTIR: yeni sayfa YOK.
- Dosyalar: `src/lib/foreign-sale-checklist.ts`, ilgili sözleşme testi. Migration YOK.

**H6. Konut kira sözleşmesi: kiralama kaydından tek tıkla sözleşme + zengin şablon**
- Değer: 4 (her kiralama işlemi; imza altyapısı hazır). Kanıt: 2 (Arveya e-imzalı sözleşme + yenileme [A], K19 [A]). Mevcut: KISMEN — `new-contract-form.tsx` içinde 4 maddelik kısa `kira` gövdesi var, global şablonlar yalnız "Kiralama YETKİ sözleşmesi" (`20260726000070`); `rentals` ile `contracts` bağlı değil (grep `rental_id` boş). Efor: S-M. Risk: hukuki — metin yer tutucu, AVUKAT onayı şart; "hukuken geçerli e-imza" iddiası YOK (SMS OTP mevcut hâliyle). **Skor 5,3.**
- Ne: `kiralama/[id]` "Sözleşme oluştur" → `/app/sozlesmeler/yeni?tur=kira&kira=<id>` (randevu tutanağı kalıbı); kira bedeli/vade günü/depozito/başlangıç-bitiş alanları ön-dolar (mevcut `fill-fields-dialog`); şablon zenginleştirme (demirbaş listesi, TBK m.344 artış klozu — mevcut madde korunur; diğer maddeler avukata).
- Dosyalar: `src/app/app/sozlesmeler/yeni/new-contract-form.tsx` + `page.tsx`, `src/app/app/kiralama/[id]/page.tsx`, (opsiyonel) migration `contracts.rental_id uuid null` FK (FK adıyla gömme kuralı) + global şablon seed (yeni UUID, forward-only).
- Kabul: mevcut sözleşme akışı değişmez; ön-doldurma salt-okunur kaynaktan; imza metninde "e-imza" ifadesi hukuki iddia taşımaz.

**H7. Satıcı net/vergi hesaplayıcı + Mevzuat Sabitleri tek merkezi (admin)**
- Değer: 4 (satıcı görüşmesinde "elime ne geçer", 5 yıl kuralı; DKV üst segment). Kanıt: 2 (K14 [A], K15 [S], K16 çelişkili). Mevcut: alıcı tarafı VAR, satıcı YOK; sabitler koda gömülü ve hepsi DOĞRULANAMADI (`docs/MEVZUAT_SABITLERI.md`). Efor: M. Risk: yüksek-orta (yanlış rakam = itibar; "mali müşavirlik değildir"). **Skor 4,0.**
- Ne: `src/lib/seller-proceeds.ts` (saf, vitest): satış bedeli − satıcı harcı − (5 yıldan kısa ise değer artışı kazancı tahmini; istisna 150.000 TL parametre) − komisyon+KDV; DKV eşik uyarısı (yalnız bilgi). Tüm yasal sabitler `platform_settings` anahtarı `legal.constants` altında (kaynak URL + doğrulama tarihi + `official=false` varsayılan; `tufe.table` kalıbı) ve `purchase-costs.ts` sabitleri de aynı merkeze taşınır (BIRLESTIR; döner sermaye 6.000 çelişkisi tek yerde çözülür). Doğrulama sahibin/mali müşavirin işidir; tarihsiz değer ekranda "doğrulanmadı" rozetli.
- Dosyalar: yeni `src/lib/seller-proceeds.ts` (+test), `src/lib/legal-constants/**`, admin `src/app/admin/ayarlar/mevzuat` (platform ayar kalıbı `platform-tufe.ts`), `src/app/app/hesaplayici/calculator-view.tsx` (`?sekme=satici`), `docs/MEVZUAT_SABITLERI.md`. Migration YOK (platform_settings). Yeni izin modülü AÇILMAZ (`valuation`).
- Kabul: tahmin etiketi + formül yanında; değer artışında "satıcının vergi durumu kişiye özeldir"; DKV yalnız uyarı.

**Sonraya (hemen yapılabilir ama ilk 10 dışı):**
- **H8. Yapı güvenliği kartı** (skor 3,0): portföyde yapı yılı + elle işaretlenen "riskli yapı sorgusu yapıldı (tarih)", EKB sınıfı, DASK bitiş + resmî sorgu bağlantıları (AFAD TDTH, e-Devlet). SKOR/puan YOK; deprem güvenliği iddiası YOK; `properties.features` jsonb ile migration'sız (K23 [S], AFAD için API YOK). `deal-checklist` "Enerji kimlik belgesi" maddesiyle BIRLESTIR.
- **H9. Sosyal paylaşım kartı** (skor 3,0): `next/og` ile 1080x1350 kart (kapak foto + fiyat/oda + ofis adı + yetki belgesi no + EİDS no), indir/kopyala; otomatik yayın YOK. Dosyalar: `src/lib/brand/social-card.tsx` + oturumlu route; filigran/`property-media-access.ts` kuralı. K13: sosyal medya EİDS kapsamında → no zorunlu alan.
- **H10. Malik kira ekstresi** (skor 3,0): `malik-portali` token sayfasında tahsilat/gecikme/depozito/bakım gideri; Arveya "malik hesabı ayrımı" [A]; rentals'ta malik bağı yok → migration + ilişki tasarımı gerekir.
- **H11. Kiracı tek-link sayfası** (ödeme bildirimi, bakım talebi; skor 1,5) → ERTELE (L, token + yükleme + RLS yüzeyi geniş; önce H3).
- **H12. İlan metni portal-kural denetçisi** (skor 2,0) → BIRLESTIR `listing-text.ts` uyarılarına; kural kaynağı K24 [X] doğrulanmadan yazılmaz.

### B. HARİCİ ENTEGRASYON / SÖZLEŞME GEREKTİREN

**E1. WhatsApp Business çift yönlü sohbet (pencere içi serbest cevap) + şablonlu otomasyon**
- Değer: 5. Kanıt: 3 (Meta fiyat sayfası [A], RE-OS WhatsApp [B], mevcut kod). Mevcut: KISMEN (giden şablon + gelen webhook + wa.me). Efor: L. Risk: orta — Meta kimliği doğrulanmış WABA (ofis başına), şablon onayı, ücret (şablon başı; Türkiye utility/auth oranı 01.01.2026'da düştü [A]; marketing rakamları [S]); açık uçlu AI bot YASAK [B], yalnız yapılandırılmış akış + insan devri. **Skor 1,9 (×0,5 harici).**
- Plan: `src/lib/messaging/whatsapp-cloud.ts` (session-text gönderim, 24 sa pencere takibi), `gelen-kutusu/` iş parçacığı görünümü (mevcut `communications` zaman çizgisi), `reply-draft.ts` (taslak, insan onayı). Migration: pencere damgası için küçük kolon/tablo olasılığı. Sahip işi: Meta hesabı (`PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` §3.2 madde K3). H3 şablonlarını bu hatta bağlar.

**E2. Portal ilan aktarımı (sahibinden API / Hepsiemlak / Emlakjet)**
- Değer: 5. Kanıt: 3 (Rekabet Kurulu kararı [B], RE-OS entegrasyon listesi [B]; Hepsiemlak geliştirici sayfası [X]). Mevcut: YOK (iskelet). Efor: L. Risk: yüksek — kurumsal sözleşme + EİDS şartı (arama özeti); kazıma YASAK. **Skor 1,9.**
- Plan: sözleşme olmadan kod yazılmaz (`PIYASA` K1/K2). Ara çözüm hemen yapılabilir olan: "portal paket dışa aktarma" (FEATURE_BACKLOG #12) — H2 EİDS no ile birlikte.

**E3. Kira tahsilat: banka hareketi eşleştirme / otomatik ödeme talimatı**
- Değer: 4. Kanıt: 3 (KiraPratik 8 banka, Arveya banka eşleştirme [A]). Mevcut: YOK (`toggleChargePaid` elle). Efor: L. Risk: yüksek — ÖHVPS katılımcısı veya lisanslı aggregator, ödeme kuruluşu sorumluluğu (K6 koşulları DOĞRULANAMADI); ofis tahsilatı için mevcut iyzico `payment_links` platform tahsilat hattı olarak KULLANILMAZ (ofis adına tahsilat = alt üye işyeri/lisans). **Skor 1,5.**
- Plan: önce H3 (hatırlatma) + H10 (ekstre); banka entegrasyonu sahip kararı.

**Sonraya (harici):**
- **E4. Nitelikli/mobil e-imza + e-Devlet Dijital Kontrat** (K8): sağlayıcı sözleşmesi (BTK yetkili ESHS), hangi belgenin hangi imzayla geçerli olduğu hukuki görüş. Kısa vadede: sözleşme ekranına "e-Devlet Dijital Kontrat'ı kullanabilirsiniz" rehber bağlantısı (iddia yok) — H6 ile.
- **E5. AI sanal staging** (SahiDeko benzeri, sahibinden Haziran 2025 [B]): görsel AI sağlayıcısı; dijital değiştirilmiş görsel etiketi ABD'de zorunlu [S], Türkiye'de portal/yasa doğrulanamadı → "sanal döşeme" etiketi + orijinal görsel bağlantısı ZORUNLU tasarım şartı.
- **E6. Türkçe ses → metin (görüşme/sesli not)**: Türkçe doğruluk verisi bulunamadı (OpenAI sayfaları genel WER verir, Türkçe yok [S]); ses kaydı KVKK/yurt dışı aktarım kararı (K5). Arada telefon klavye dikte (kodsuz).
- **E7. Instagram otomatik yayın** (K21): PPA + uygulama incelemesi + ofis başına bağlantı; H9 kartı hazır olunca manuel paylaşım yeter.
- **E8. TKGM/TAKBİS/imar canlı sorgu**: resmî API sayfada yok [B]; AFAD sorgusu e-Devlet girişli [S]; kazıma YAPILMAZ.
- **E9. Meta Lead Ads** (`registry.ts` "planned"): Meta uygulaması + sayfa tokenı.

---

## 5. İlk 10 (sıralı)

### Hemen uygulanabilir (harici anahtar/sözleşme gerektirmeyen) — 7

| Sıra | Özellik | Skor | Efor | Migration | Tek cümle gerekçe |
|---|---|---|---|---|---|
| 1 | H1 GÖS hazırlığı | 10,0 | S | yok | Zorunluluk 1 Aralık 2026'da başlıyor ve ürünün hiçbir yerinde iz yok; ucuz, kaynaklı ve ofisi ceza/dolandırıcılık riskinden korur. |
| 2 | H2 EİDS taşınmaz no + yetki takibi | 6,7 | S-M | 1 sütun | Satılık konut ilanı 15.02.2026'dan beri taşınmaz numarasıyla yayınlanıyor, ürün bu veriyi hiç tutmuyor ve ilan sağlık skorunda "ölçülemedi" diyor. |
| 3 | H3 Kiracıya kira hatırlatma | 6,0 | M | opsiyonel 1 kolon | Rakiplerin ortak vaadi (KiraPratik/Arveya) ve bizde cron yalnız ofise yazıyor; kapalı doğan, wa.me ile başlayan güvenli adım. |
| 4 | H4 Çok dilli ilan metni | 6,0 | S | yok | Mevcut AI hattıyla bir günlük iş; yabancıya satış yapan ofislerde doğrudan satış aracı (RE-OS/Hepsiemlak'ta var). |
| 5 | H5 Yabancı satış güncellemesi (ikamet 200.000 USD + GÖS) | 6,0 | S | yok | Var olan modülün bayat kalan iki bilgisini düzeltir; yeni sayfa açmaz. |
| 6 | H6 Kiralamadan tek tık kira sözleşmesi | 5,3 | S-M | opsiyonel | İmza altyapısı ve kira kaydı hazır ama birbirine bağlı değil; her kiralamada tekrar yazma emeğini bitirir. |
| 7 | H7 Satıcı net/vergi hesaplayıcı + mevzuat merkezi | 4,0 | M | yok | Satıcıya "net ne kalır" cevabını verir ve koda gömülü doğrulanamayan sabitleri (döner sermaye çelişkisi dahil) tek, tarihli, kaynaklı yere toplar. |

### Harici entegrasyon gerektiren — 3

| Sıra | Özellik | Skor | Efor | Engel | Tek cümle gerekçe |
|---|---|---|---|---|---|
| 8 | E1 WhatsApp çift yönlü sohbet | 1,9 | L | Meta WABA + şablon onayı + ücret | Türk ofislerinin birincil kanalı; altyapının yarısı (webhook, şablon gönderim, taslak cevap) hazır, eksik yalnız pencere içi cevap ve iş parçacığı. |
| 9 | E2 Portal ilan aktarımı | 1,9 | L | kurumsal sözleşme + EİDS şartı | Pazarın ana vaadi (RE-OS 15+ portal) ve en büyük satın alma engeli; sözleşme olmadan kod yazılmaz, ara çözüm paket dışa aktarma. |
| 10 | E3 Kira tahsilat banka eşleştirme | 1,5 | L | ÖHVPS/aggregator + lisans | KiraPratik ve Arveya'nın bank bağlantısı rakip kıyasında görünür; H3/H10 olgunlaşmadan açılmamalı. |

---

## 6. Reddedilen / ertelenen

| Konu | Karar | Gerekçe |
|---|---|---|
| Kentsel dönüşüm modülü | ERTELE | Hak sahipliği/arsa payı/müteahhit süreci hukuki ve veri yoğun; rakip kanıtı bulunamadı; yalnız mevcut etiket + H8 kartı. |
| Otonom AI sesli arama/otonom WhatsApp botu | REDDET (şimdi) | Meta açık uçlu bot yasağı [B]; FUB bile otonom ses sunmuyor [A]; KVKK; yapılandırılmış akış + insan devri dışında yok. |
| Portal "kaç görüntüleme/favori" verisi çekme | REDDET | Kazıma/ToS yasağı (`ROADMAP`); ofisin kendi vitrin verisi yeter. |
| AFAD/e-Devlet deprem sorgusunu otomatik çekmek | REDDET | e-Devlet girişi ister, API yok [S]; yalnız resmî bağlantı ve elle işaret (H8). |
| Yurt dışı referans komisyon ağı (eXp tarzı) | ERTELE | TR ağ (`ag`, `referrals`) var; %20-35 paylaşım ücretleri ABD pratiği [S], yerel hukuk/vergi doğrulanmadı. |
| Deprem "risk skoru" | REDDET | Sahte skor yasağı; ölçülebilir resmî girdi yok. |
| Kiracı tek-link sayfası (H11) | ERTELE | Efor L, token+yükleme yüzeyi; önce H3. |
| Ses→metin (E6) | ERTELE | K5 sahip kararı; Türkçe doğruluk doğrulanamadı. |
| Rakip adlı karşılaştırma tablosu | REDDET | Doğrulanamaz, fiyatlar değişir. |

---

## 7. Doğrulanamayanlar ve çelişkiler (KODA SABİTLENMEZ)

1. **GÖS tarihi:** kaynaklar 1 Temmuz → 1 Ekim → **1 Aralık 2026** sırasını gösteriyor; en yeni (gzt.com, Bakanlık açıklaması 28.09.2026) 1 Aralık. "1 Ekim zorunlu" diyen sayfalar (fokusplus, gayrimenkulhaber) daha eski olabilir. Resmî Gazete/Ticaret Bakanlığı metni açılamadı → ayar + doğrulama tarihi şart (H1).
2. **Tapu döner sermaye:** 6.681 TL [S] / 2.534-6.988 TL [A] / kodda 6.000 TL (`purchase-costs.ts:102`) → doğrulanamadı; H7 merkezine taşınıp sahip/mali müşavir doğrular.
3. **TÜFE:** `tufe.ts` gömülü tablo 2025-12'de bitiyor, 2026-01..07 "bekleyen" (`TUFE_PENDING_MONTHS`); Ekim 2026 %31,49 yalnız hukuk bürosu özeti [S] (Eylül 2026 %31,79: önceki belge [B]). Resmî değer `/admin/ayarlar/tufe` ekranından kaynak+tarihle girilmeli (SAHİP İŞİ; ürün kodu değişmez).
4. **Değer artışı istisnası 150.000 TL** ve DKV tarife dilimleri: tek-iki ikincil kaynak; mali müşavir teyidi.
5. **EİDS "tek işletme yetkilendirilebilir"** ve satılık konut tarihleri (15.02.2026 vs 01.02.2026): haber sayfaları arasında 14 günlük fark var (önceki belge 01.02.2026, yeni haberler 15.02.2026) → resmî metinle teyit.
6. **Taşınmaz Kimlik Numarası biçimi:** doğrulanamadı → yalnız serbest metin.
7. **sahibinden ilan kuralları** (K24): sayfa 403; "510 karakter ideal" gibi arama özeti ifadeleri KULLANILMADI.
8. **Meta fiyat rakamları (Türkiye marketing/utility USD):** resmî sayfadan okunamadı; yalnız 3. parti [S]; ücret kararı sahipte.
9. **Hiçbir kullanım/gelir verisi ölçülmedi:** "Değer" puanları yargıdır; satıcı bloglarındaki dönüşüm/oran iddiaları (3,4x, %15-25) kullanılmadı.

---

## 8. SAHİP KARARLARI (öneriyle)

| # | Karar | Seçenekler | Öneri |
|---|---|---|---|
| S1 | H1 sözleşme şablonlarına GÖS maddesi | (a) yalnız checklist+kart (b) şablonlara da madde | (a) şimdi; (b) avukat onayından sonra |
| S2 | H3 kiracı SMS'i işlem iletisi mi (İYS dışı) | (a) yalnız wa.me/görev (b) SMS ofis Netgsm'iyle | (a) hemen; (b) hukuki teyitten sonra, kapalı doğar |
| S3 | H6 kira sözleşmesi metni | avukat metni / yer tutucu bırak | Yer tutucu + "avukat onaylı şablonunuzu yükleyin" yolu |
| S4 | H7 yasal sabitlerin doğrulayıcısı | sahip / mali müşavir | Mali müşavir; doğrulanmamış değer "doğrulanmadı" rozetli kalır |
| S5 | E1 WhatsApp | Meta WABA başvurusu (ofis başına) | Önce 1-2 pilot ofis; marketing şablonu ücretini pakete yansıtma kararı ayrı |
| S6 | E2/E3 | sözleşme/lisans başvurusu | Sahip işi; kod yazılmadan önce yazılı erişim |
| S7 | PANEL_KARAR U14 ("yeni özellik yayın penceresi bitmeden eklenmez") | H1/H5 (migration'sız) hemen mi | Migration'sız H1/H4/H5/H7 yayın penceresini bekletmez; H2/H3/H6 migration içerenler pencere sırasına girer (`docs/runbooks/YAYIN_PENCERESI_2.md`) |

## 9. Önerilen uygulama sırası (küçük, geri alınabilir adımlar)

1. H1 + H5 (tek PR/commit: ortak GÖS metni `foreign-sale-checklist` ↔ `deal-checklist-templates`), 2. H4, 3. H2 (migration + forma alan + sağlık skoru girdisi), 4. H3 aşama 1 (wa.me) → aşama 2 (SMS), 5. H6, 6. H7 (önce `legal-constants`, sonra hesaplayıcı), 7. H8/H9. Her adım kendi commit'i; E1-E3 sahip kararı S5/S6 sonrası.
Dogrulama kapısı (tsc, eslint, vitest, check:*, build) uygulama adımlarında çalışır; bu belge için çalıştırılmadı (yalnız docs).
