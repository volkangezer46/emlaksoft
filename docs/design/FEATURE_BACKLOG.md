# EmlakSoft — Özellik Boşluk Analizi ve Öncelikli Backlog

Tarih: 2026-10-03 · Amaç: "bu proje yok satmalı" hedefi için satın alma kararını etkileyen eksikleri gerçek araştırma + koddan doğrulama ile çıkarmak. Kod değiştirilmedi.
Kural: Kaynakta bulunmayan rakam/pazar verisi yazılmadı; bulunamayan "doğrulanamadı" diye işaretlendi. Belge ile kod çelişirse koda güvenildi.
Not: Arama sonucu özetine dayanan ama sayfası açılamayan iddialar "(arama özeti)" ile işaretlidir.

## (a) Kaynaklar ve çıkarımlar

Sayfası gerçekten açılan kaynaklar:

| Kaynak | Çıkarım |
|---|---|
| https://www.arveya.com/emlak-crm/ozellikler | Türk rakip: müşteri kartında not/belge/görev/çağrı tek geçmiş; **gelen çağrıyı müşteriye eşleme**, sanal santral, çağrı transkripsiyonu + AI özeti, CSV/Excel/başka CRM'den içe aktarma, form/webhook/API. |
| https://www.portfoycrm.com/ | Türk rakip: 7 kademeli paket (Bireysel Temel 599 TL/ay, 25 portföy → Ofis Pro 8.799 TL/ay, 20 kullanıcı; Kurumsal "teklif"), **14 gün ücretsiz deneme**, ofisler arası eşleşme, AI sunum. Fiyatı sayfada açık yazıyor. |
| https://re-os.com/ | Türk rakip: çoklu portal dağıtımı (HepsiEmlak, EmlakJet, yurtdışı portallar), hazır web sitesi + 360° tur, AI değerleme/çeviri, **mobil CRM + arayan tanıma ("telefon çalınca CRM açılır")**. Müşteri sayıları site beyanıdır, doğrulanamadı. |
| https://www.crmprogrami.tr/emlak-ofisi-icin-crm-programi/ | Satın alma kriterleri: talep+iletişim kaydı, portföy, randevu çakışma/hatırlatma, teklif→sözleşme→komisyon takibi, **ilan sitelerine ve iletişim kanallarına entegrasyon**, kullanıcı/modül bazlı fiyat. Tipik kurulum 3-4 hafta + eğitim (kaynak beyanı). |
| https://theclose.com/follow-up-boss-review/ | Follow Up Boss: Smart Lists, Action Plans, lead routing, aşama/etiket/özel alan, AI çağrı özeti; Grow $69/kullanıcı-ay, 14 gün deneme; kurulum "aşama/etiket/Smart List planı gerektirir", büyük veritabanında zaman alır; **işlem yönetimi ve web sitesi yok**. |
| https://www.stackscored.com/pricing/real-estate-crm/boldtrail/ | BoldTrail (kvCORE): Platform (CRM+site+lead gen) / BackOffice (komisyon, muhasebe) / Recruit modülleri; **fiyat açık değil, deneme yok** — EmlakSoft için açık fiyat+deneme farklılaşma noktası. |
| https://www.mfylegal.av.tr/haberler/sahibinden-api-veri-tasima-karari-26-06-2025/ | Rekabet Kurulu (26.06.2025, 25-23/574-365): Sahibinden kurumsal üyelerin ilanlarını rakip platformlara **ücretsiz taşıması için API** kurmakla yükümlü; API 21.05.2025'te devrede. Bu bir "üçüncü taraf CRM erişimi" kararı değil, veri taşınabilirliği taahhüdü. |
| https://www.emlakjet.com/blog/api-ile-ilan-transfer-sistemi-nedir-ve-nasil-kullanilir | Pratik akış: ofisim.sahibinden.com'dan **API anahtarı üret** → alıcı portalda gir → SMS onayı. Yani anahtar mağaza sahibinde; kullanıcı bazlı anahtarla aktarım modeli var. |
| https://canakkale.ticaret.gov.tr/duyurular/elektronik-ilan-dogrulama-sistemi-eids-ilan-izin-bilgileri-hakkinda-duyuru | Ticaret Bakanlığı (03.06.2025): emlak işletmeleri TTBS'de "EİDS İlan İzinleri" sekmesinden taşınmaz kimliği, mal sahibi ve yetki bitiş tarihini görür. |
| https://www.mehmetbalcigayrimenkul.com/eids-satilik-ilan-yetki-dogrulama-2026/ | (ikincil, emlakçı blogu) 01.01.2025 kiralık, 07.04.2025 ticari satılık, 01.02.2026 konut dahil tüm satılık ilanlarda yetki doğrulaması; ofis en az 3 ay yetki süresi. Resmî metinle teyit edilmeli. |
| HubSpot (yalnız arama özeti; hubspot.com sayfası açılmadı: community.hubspot.com ve rehber sonuçları) | Özel deal özellikleri, alıcı/satıcı/kiralama ayrı pipeline, Listing nesnesi, CSV'de sütun eşleme; "önce aşama ve yaşam döngüsünü tanımla" tavsiyesi. |

Yalnız arama sonucu özetinden (sayfa açılamadı / 403 / bağlantı hatası): Wise Agent vs LionDesk karşılaştırmaları (Wise Agent işlem yönetimi güçlü, LionDesk yerleşik SMS/video e-posta), Propertybase (lead→komisyon ödemesine pipeline, MLS/IDX), Zillow Premier Agent (lead'e dakikalar içinde dönüş vurgusu), Remax/Century21 Türkiye (C21 Online intranet: performans, danışman takibi, ödül sistemi; RE/MAX franchise hizmetleri), Sahibinden yardım sayfası (403, doğrulanamadı), Taşınmaz Ticareti Yönetmeliği (satış hizmet bedeli en çok %4+KDV, kira 1 aylık kira; kaynaklarda KDV %18/%20 farklı yazılı → **güncel oran doğrulanamadı**), Emlak365/Hepsiemlak ofis paketleri ve Salesforce Real Estate (**incelenmedi/doğrulanamadı**).

Genel çıkarım: rakiplerin ortak vaadi (müşteri/portföy/eşleştirme/çağrı/portal dağıtımı) EmlakSoft'ta büyük ölçüde var; rakiplerin öne çıktığı yerler **arayan tanıma, portal dağıtımı, açık fiyat+deneme, kurulum/içe aktarma kolaylığı, lead hız kuralları ve özelleştirilebilir aşama/alanlar**.

## (b) Mevcut özellik envanteri (koddan)

Menü: `src/lib/nav-config.ts` 9 başlık. Paketler: `plans.ts` (Danışman 990, Ofis 2.490, Profesyonel 5.990, Kurumsal 12.900 TL/ay; yıllık %20 indirim) + `page-gates.ts` (26 sayfa kilidi).

| Modül | Gerçekten çalışan (sayfa + action doğrulandı) |
|---|---|
| Bugün | Ana ekran, günlük brifing (`briefing.ts`, AI opsiyonlu), ofis kurulum sihirbazı `/app/baslangic` (+`onboarding-setup.ts`), AI asistan, örnek veri (`sample-data.ts`, `is_sample`) |
| Müşteriler | Müşteri 360, talepler, eşleştirme (kural tabanlı skor), akıllı listeler, kayıtlı görünümler (`saved-views.ts`), çift kayıt tespiti, etiketler (`tenant-tags.ts`), tavsiye/referans, toplu işlemler, CSV içe aktarma sihirbazı `/app/ice-aktarma` (yalnız müşteri ve portföy alanları, başlık ipuçlu otomatik eşleme) |
| Portföy | Portföy CRUD, harita, karşılaştırma, medya + filigran, fiyat geçmişi, anahtar takibi, sunumlar, kiralama + kira artışı, projeler, açık ev (QR, public kayıt), portal kontrol (teyit/yenileme/kapanış — kazıma yok), ofisler arası ağ, yabancıya satış kontrol listesi |
| Anlaşmalar | Pano (aşamalar kodda sabit: new/qualified/negotiation/won/lost), teklif turları, sözleşme + SMS OTP e-imza, anlaşma kontrol listesi (`deal-checklist.ts`) |
| İletişim | Gelen kutusu + SMS (Netgsm), Meta WhatsApp **webhook alma** (`api/webhooks/meta`, imzalı), akıllı arama + AI çağrı özeti, randevu (çakışma, hatırlatma cron), görev, İYS uyumlu kampanyalar, mesaj şablonları |
| Finans | Komisyon (tavan uyarısı `commission-cap.ts`), cüzdan, onay akışları, gider, aidat, ödeme linki (iyzico) |
| Performans | Raporlar, kayıp-kaçak motoru, danışman KPI, lig, hedefler, bölge analizi, kayıp satış, TV panosu |
| Araçlar | Değerleme (ofis emsali + Endeksa + Tapusor; anahtar yoksa atlanır), hesaplayıcılar (tapu masrafı, kira), public "Evim ne kadar eder" |
| Ofis | Ekip + roller matrisi + kullanıcı istisnaları, otomasyonlar, iş akışları, KVKK/uyum, belge merkezi, denetim, abonelik, destek, çöp kutusu, 2FA, vitrin, malik/müşteri portalı |
| Public | Landing (fiyat bölümü, loss-story, güvenlik bandı), `/demo` formu, `/kayit`, vitrin, ilan paylaş, randevu-al, sunum, anket |

Kod-belge farkları: `portals/index.ts` yalnız adaptör **iskeleti** (Sahibinden/Hepsiemlak/Zingat/Emlakjet, platform_settings anahtarı gerekir; gerçek yayın doğrulanmadı); e-fatura (`efatura.ts`) iskelet; EİDS/İYS/BTRANS resmi entegrasyon yok (ROADMAP); `/fiyatlar`, `/guven`, ROI/kayıp-komisyon hesaplayıcı **sayfaları yok** (fiyat yalnız landing bölümünde). Özel alan (custom fields) için altyapı **bulunamadı**.

## (c) Boşluk analizi (satın alma kararını etkileyenler)

Etki 1-5 · Efor S/M/L · "Dış" = dış hesap/API bağımlılığı.

| # | Boşluk | Etki | Efor | Risk | Bağımlılık / dürüst durum |
|---|---|---|---|---|---|
| G1 | **Anlaşma aşamaları/kayıp nedeni ofis tanımı**: aşamalar kodda sabit (`DEAL_STAGES`), kayıp nedeni serbest metin; raporlar nedeni gruplayamaz | 5 | M | Orta: aşama değeri enum/CHECK ve olasılık/otomasyon/rapor sayaçlarına bağlı | Yok. Kayıp nedeni kolay (S), aşama yeniden adlandırma/sıra ayrı (M) |
| G2 | **Özel alanlar** (müşteri/portföy/talep): rakiplerde (FUB, HubSpot) standart | 4 | L | Yüksek: filtre, dışa aktarma, içe aktarma, RLS hepsine dokunur | Yok |
| G3 | **İçe aktarma kapsamı**: yalnız müşteri+portföy; talep, anlaşma, geçmiş notlar, "başka CRM'den" şablonları, önizleme+geri alma yok | 5 | M | Düşük-orta | Yok |
| G4 | **Açık fiyat + ROI/kayıp-komisyon hesaplayıcı + deneme akışı** (rakipler: PortföyCRM açık fiyat+14 gün deneme; BoldTrail kapalı) | 5 | S-M | Düşük (yanıltıcı rakam riski, bkz. (i)) | Yok |
| G5 | **Lead hız SLA'sı ve atama kuralları** (bölge/fiyat/kaynak; ilk temas süresi raporu): FUB/Zillow vurgusu; kodda round-robin + leak SLA cron var, kural yapılandırma ekranı belirsiz | 4 | M | Orta | Yok |
| G6 | **Arayan tanıma / mobil**: Arveya, RE-OS öne çıkarıyor. Web tabanlı üründe telefon çağrısını yakalamak sanal santral/CTI ister | 4 | L | Yüksek | **Dış**: santral/CTI sağlayıcı. Yalnız "yardımcı": gelen çağrı webhook'u + numara eşleme; yerel arayan tanıma yapılamaz |
| G7 | **Çok portallı ilan dağıtımı** (RE-OS, Emlaksis vb. ana vaat) | 5 | L | Çok yüksek | **Dış**: Sahibinden yardım sayfasına göre (arama özeti) API, EİDS'e entegre veya API sözleşmesi imzalamış firmalara açık. Resmî sözleşme yoksa **yapılamaz**; yalnız yardımcı: ilan metni/foto paketi dışa aktar, kopyala-yapıştır, XML dışa aktarma (portal formatı doğrulanamadı) |
| G8 | **WhatsApp**: gelen webhook kodu var; giden şablon + ekip gelen kutusu UI ve hesap aktivasyonu belirsiz | 5 | M-L | Orta (Meta politikası, şablon onayı) | **Dış**: Meta Business hesabı. Hesap yokken yalnız `wa.me` linkli hazır mesaj (yardımcı) yapılabilir |
| G9 | **EİDS/yetki takibi yardımcısı**: yetki bitiş tarihi, ilan başına "e-Devlet yetkisi alındı mı" alanı ve bitiş uyarısı. TTBS verisini çekmek için resmî API **doğrulanamadı** | 5 | S-M | Düşük (hukuki tavsiye vermemeli) | Resmî API yok varsayılır: **elle giriş + uyarı** (yalnız yardımcı) |
| G10 | **Güven merkezi**: yedek/restore provası açık (ROADMAP P0), 2FA platformda kapalı, KVKK metni var | 4 | M | Yüksek: kanıtsız vaat | İçerik yalnız doğrulananı söylemeli, bkz. (g) |
| G11 | Dijital yer gösterme tutanağı (rakip yok görünüyor; master listede "kritik" notu): randevudan imzalı tutanak | 4 | M | Düşük | Yok; e-imza altyapısı mevcut |
| G12 | Mobil/PWA derinliği (offline, push) | 3 | L | Orta | Yok |
| G13 | Açık API/webhook + API anahtarı (Arveya sunuyor) | 3 | L | Orta | Yok |
| G14 | Çok dilli ilan çevirisi (RE-OS AI çeviri) | 2 | S | Düşük | OpenAI, `openai-client.ts` üzerinden |
| G15 | Muhasebe/e-fatura | 3 | L | Yüksek | **Dış**: entegratör hesabı; iskelet var, ürün vaadi yapma |

## (d) Mükerrer/çakışan işlevler — tekrar önerme, birleştir

- **Kayıp nedeni**: deal-board `Kayıp nedeni` diyaloğu (serbest metin) + `kayip-satis` (kayıp satış dedektörü) + `kayip-kacak` (portal kapanışı) + raporlardaki "kayıp nedeni raporu". Yeni "kayıp analizi sayfası" ekleme; G1'deki tanım kategorisini üç yerde de ortak kullan. İsimler (Kayıp Satış / Kayıp-kaçak) kullanıcıyı karıştırır; sayfa başlığında tek cümlelik ayrım ekle (dedektör = müşteri/anlaşma riski; kaçak = rakibe kapanan ilan).
- **Kurulum/ilk gün**: `/app/baslangic` (sihirbaz) + örnek veri CTA (`sample-data-cta.tsx`) + ürün turu (`product-tour.tsx`) + Ana ekran "Başlayalım" kartı. Yeni onboarding bileşeni yazma; tek ilerleme kaynağına (setup-wizard) bağla.
- **Hesaplayıcılar**: `/app/hesaplayici` (tapu masrafı, kira) + `kira-artis` + public değerleme. ROI/kayıp-komisyon hesaplayıcı gerekirse aynı `commission.ts`/`commission-cap.ts` saf fonksiyonlarını kullansın, ayrı hesap motoru yazma.
- **Görev/randevu hatırlatma**: otomasyonlar + `randevu-hatirlat` cron + iş akışları + playbooks. "Takip planı (Action Plan)" için yeni motor değil, otomasyon şablonları genişletilir.
- **Ekip performansı**: Danışman KPI + Lig + Hedefler + TV panosu + dashboard widget — yeni "lider tablosu" önerme.
- **Şablonlar**: `message-templates.ts` + `campaign-templates.ts` + deal-checklist şablonları + sözleşme şablonları — dört ayrı yerde. Birleşik "Şablonlar" girişi (Ayarlar > Tanımlar altında sekme) önerilir; veri modeli birleştirilmeden yalnız gezinme birleşimi (S).

## (e) "Tanımlar" boşlukları

Mevcut altyapı: `definition-defaults.ts` (9 kategori: müşteri tipi/kaynağı, portföy tipi, işlem tipi, sözleşme tipi, gider kategorisi, randevu tipi, talep aciliyeti, destek kategorisi), `definitions.ts` + `/app/ayarlar/tanimlar` (sıralama, renk, kullanım kontrolü, denetim), `is_system` ile silinemez sistem değerleri (`SYSTEM_DEFINITION_VALUES`), tek-kaynak sözleşme testleri.

Ofis tarafından yönetilmesi gerekip yönetilemeyen listeler ve yaklaşım:

| Liste | Durum | Mevcut altyapıyla yol |
|---|---|---|
| Kayıp nedeni | Serbest metin | Yeni kategori `loss_reason`; sistem değeri "diğer"; deal-board seçim + opsiyonel not; eski serbest metin kayıtlar "diğer + not" olarak raporlanır (veri göçü yok, geriye uyum) |
| Anlaşma aşamaları | Sabit enum | Doğrudan kategoriye çevrilemez (olasılık, otomasyon, rapor, `won/lost` anlamı). Öneri: sabit 5 "kanonik" anahtar kalır, ofis **etiketini ve rengini** değiştirir (yalnız görünen ad) — enum'a dokunmadan G1'in %80'i |
| Etiketler | `tenant-tags.ts` var (müşteri); portföy/talepte yok | Aynı yapıyı genişlet |
| Belge türleri | Belge merkezi var, tür listesi tanım değil (doğrulanmalı) | Yeni kategori `document_type` |
| Özel alanlar | Yok | Ayrı tasarım (G2); önce yalnız "metin/seçim/sayı" ve yalnız müşteri+portföy |
| Şablonlar | Dağınık (d) | Gezinme birleşimi |
| Portal/kanal adları, ilçe/mahalle | Geo tablosu ayrı | Tanıma alma |

Kural: yeni kategori eklerken `definition-single-source-contract.test.ts` ve `definition-quality-contract.test.ts` gereği değerlerin tek kaynaktan gelmesi şart; sistem değerleri `is_system` ile korunur.

## (f) İlk 5 dakika / ilk hafta

Mevcut güçlü yan: kurulum sihirbazı, örnek veri, ürün turu, CSV sihirbazı, demo-ofis seed. Eksikler:

1. **Rol bazlı sade mod**: danışman 45 sayfalık menüyü görüyor; menü zaten 9 başlık ama danışman için "Bugün/Müşteriler/Portföy/Anlaşmalar/İletişim" 5 başlığa daraltılmış varsayılan görünüm yok (yetki matrisi var; yalnız görünüm tercihi gerekir). S-M.
2. **Başka sistemden geçiş**: Arveya "başka CRM'den içe aktarma" diyor. EmlakSoft'ta bilinen Türk emlak programlarının dışa aktarma sütun adlarına hazır eşleme şablonları — **hangi programın hangi sütunları verdiği doğrulanamadı**, gerçek örnek dosya gerekir; uydurma şablon yazma. Önce genel eşleme kalitesini (talep, anlaşma, not) artır.
3. **İçe aktarma önizleme + geri alma** (toplu işlem kimliğiyle tek tıkla geri). Tek eksik "korkusuz yükle" güveni.
4. **Kurulum şeridi → rol bazlı**: sahip için var; danışman için "ilk müşteri, ilk portföy, ilk randevu" 3 adımı yok.
5. **İlk hafta e-postası/brifing**: brifing var; "7. gün özet" (kaç kayıt, kaç eşleşme, kaçan komisyon uyarısı) yok. Cron mevcut, e-posta sağlayıcısı seçimi ROADMAP'te açık (**dış**).

## (g) Satış yüzeyleri

Mevcut: landing + fiyat bölümü + güvenlik bandı + loss-story + `/demo` + `/kayit` + yasal sayfalar. Yok: ayrı `/fiyatlar`, ROI hesaplayıcı, "kaçan komisyon" hesaplayıcı, güven merkezi, karşılaştırma sayfası.

Doğrulanabilir içerik (kodda/belgede kanıtı olan, vaat edilebilir): kiracı izolasyonu RLS (`db:rls-audit`), Frankfurt veritabanı bölgesi (security-band kendi metni; DEPLOY ile teyit), denetim kaydı, her dışa aktarmanın loglanması, AI'ya giden kişisel verinin maskelenmesi (`redact.ts` + sözleşme testi), portal kazıma yapılmaması, AI'nın yalnız onaylı aksiyon alması, KVKK silme/anonimleştirme akışı, paket fiyatları (`plans.ts`).
Doğrulanamayan/vaat edilmemesi gerekenler: yedek/PITR ("restore provası açık"), platform MFA ("kapalı"), uptime/SLA rakamı, müşteri sayısı, "X% daha çok satış", portal canlı yayını (adaptör iskelet), WhatsApp'ın "hazır" olduğu (hesap bekliyor), EİDS/İYS "entegre" olduğu.

ROI/kayıp-komisyon hesaplayıcı: girdiler ziyaretçinin kendi sayıları (aylık lead, kapanış oranı, ort. komisyon, kaçan satış sayısı); sonuç "sizin girdilerinizle hesaplandı" etiketli; sektör ortalaması **kullanılmaz** (doğrulanmış kaynak yok).

## (h) Öncelikli 12 özellik (etki/efor sırasıyla)

Ortak test yaklaşımı: saf hesap/mantık için vitest birim; sözleşme testleri (tanım tek-kaynak, `postgrest-embed-hint`, iletişim alanı) kırılmamalı; sayfa için `check:links`; yeni migration forward-only + `check:migrations`.

**1. Kayıp nedeni tanımı (BU TUR UYGULANABİLİR — S, dış bağımlılık yok)**
- Kabul: Ayarlar>Tanımlar'da "Kayıp nedeni" kategorisi (varsayılan liste; "diğer" sistem değeri); deal-board diyaloğu liste + opsiyonel not; Raporlar'daki kayıp nedeni raporu aynı değerleri gruplar; serbest metin eski kayıtlar "Diğer" altında görünür; zorunluluk korunur.
- Bağlanır: `definition-defaults.ts`, `deals.ts` (`loss_reason`), `deal-board.tsx`, rapor sayfası.
- Mükerrer riski: yeni sayfa açma; Kayıp Satış/Kayıp-kaçak ile karıştırma.
- Test: tanım sözleşme testleri, `deals` kayıp-nedeni zorunluluk testi, eski değer fallback birim testi.

**2. Anlaşma aşaması etiket/renk özelleştirme (BU TUR UYGULANABİLİR — M, dış bağımlılık yok)**
- Kabul: sabit 5 anahtar; ofis görünen adı/rengi değiştirir (ör. "Teklif aşamasında" → "Pazarlık"); pano, rapor, liste rozetleri etiketi tanımdan okur; olasılık/otomasyon/rapor mantığı anahtara bağlı kalır; sıfırla düğmesi.
- Bağlanır: tanım altyapısı + `workflow-state.ts` etiket yardımcısı, `deal-board.tsx`, raporlar.
- Risk: etiketin başka yerde sabit yazılması; çözüm: tek `stageLabel()` ve sözleşme testi.
- Test: etiket çözümleme birim; sabit-metin tarama sözleşme testi.

**3. Açık fiyat sayfası + ROI/kaçan komisyon hesaplayıcı (BU TUR UYGULANABİLİR — S-M, dış bağımlılık yok)**
- Kabul: `/fiyatlar` `PLANS`ten üretilir (fiyat tek kaynak), aylık/yıllık anahtar; sayfa altında hesaplayıcı: girdiler kullanıcıya ait, çıktı hesap formülü yanında gösterilir, sektör verisi yok; `/demo` ve `/kayit?plan=` bağlantıları. Sonuç "tahmindir" etiketli.
- Bağlanır: `pricing-section.tsx`, `plans.ts`, `commission.ts` saf fonksiyonları, sitemap.
- Mükerrer riski: landing'deki fiyat bölümü — aynı bileşeni yeniden kullan.
- Test: formül birim testi, `plans` ile sayfa fiyat eşitliği sözleşme testi, e2e public smoke.

4. **EİDS/yetki takibi (yardımcı)** (S-M): portföyde "e-Devlet yetki bitiş tarihi" alanı, süre dolmadan görev/uyarı (otomasyon), portal kontrol sayfasında "yetkisi eksik ilan" filtresi. Kabul: elle giriş; "resmî doğrulama değildir" notu. `uyum`, `portallar`, otomasyon. Mükerrer riski: `authority-shield.ts` zaten yetki belgesi süresi için var — önce o dosya incelenip genişletilmeli (kod incelenmedi, doğrulanmalı). Test: uyarı eşiği birim.
5. **İçe aktarma genişletme + önizleme/geri alma** (M): talep ve not kapsamı, geri alma. Mevcut `import-wizard.tsx` genişletilir. Test: eşleme birim, geri alma entegrasyon.
6. **Lead hız SLA paneli + atama kuralı** (M): ilk temas süresi raporu, kaynak/bölge kuralı. `lead-intake.ts`, `ayarlar/lead`, leak SLA cron. Mükerrer riski: kayıp-kaçak SLA cron'u ile aynı sayaç.
7. **Dijital yer gösterme tutanağı** (M): randevu sonucundan imzalı tutanak. `appointments`, `contracts` e-imza, `deal-checklist`. Dış bağımlılık yok.
8. **Rol bazlı sade mod + danışman kurulum şeridi** (S-M): `nav-config.ts` + `layout.tsx`; yetki matrisi değişmez.
9. **WhatsApp ekip gelen kutusu + giden şablon** (L, **dış**: Meta Business hesabı). Hesap yoksa yalnız `wa.me` hazır mesaj (S) ve "yakında" vaadi yapılmaz. Mevcut `api/webhooks/meta` ve `gelen-kutusu` kullanılır.
10. **Özel alanlar v1** (L): yalnız müşteri+portföy, 3 tür; filtre/dışa aktarma/içe aktarma bağlantısı. En yüksek mimari risk.
11. **Güven merkezi sayfası** (M): yalnız (g)'deki doğrulanabilir maddeler; yedek provası tamamlanmadan o satır eklenmez. Sahip işi (backup/PITR) bağımlı.
12. **Portal paket dışa aktarma / XML yardımcısı** (M): ilan metni+foto+özellik tek tık paket; resmî portal formatı **doğrulanamadı**, kullanıcı "portala yapıştır" akışıyla sınırlı kalır.

## (i) Yapılmaması gerekenler

- Sahibinden/Hepsiemlak/Zingat'tan **kazıma** veya şifreyle oturum açma; ToS ve hukuki risk (ROADMAP de yasaklıyor). API yalnız kurumsal sözleşme + resmî anahtar ile.
- "Sahibinden/Hepsiemlak entegre", "EİDS entegre", "İYS entegre", "e-fatura hazır", "WhatsApp hazır" gibi kanıtsız vaat — adaptörler iskelet; resmî erişim yok.
- TTBS/e-Devlet/TKGM verisini otomatik çekmek veya taklit etmek; yetki durumunu "doğrulandı" göstermek.
- Mevzuat sabitlerini sessiz gömmek: komisyon tavanı %4/1 kira ve KDV oranı `TURKIYE_UYUM_NOTLARI.md`'de "doğrulanmalı"; kaynaklarda KDV %18/%20 çelişkili. Ekrana "hukuki danışmanlık değildir + son doğrulama tarihi" konmadan oran gösterme; tavan aşımı yalnız uyarır, engellemez.
- Sektör ortalaması, "%X daha fazla satış", müşteri/ofis sayısı, uptime gibi uydurma veya doğrulanamayan rakam.
- Rakip adı verip "daha iyi" karşılaştırma tablosu (doğrulanabilir değil; fiyatlar değişir).
- Sahte skor/boş vaat (CLAUDE.md "sıfır çıkmaz metrik"): ofis skoru kural tabanlıdır, "AI" diye satılmaz.
- Aynı işi ikinci yerde yapmak (bkz. (d)).
- Güvenlik önlemlerini onaysız sertleştirmek (zorunlu 2FA vb. — proje sahibi kararı) ve secret/prod env/backup işlerine ajan olarak dokunmak (sahip işi).
