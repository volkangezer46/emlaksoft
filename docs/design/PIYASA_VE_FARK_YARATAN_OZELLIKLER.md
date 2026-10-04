# Piyasa Taraması ve Fark Yaratan Özellik Önerileri

Tarih: 2026-10-04 · Kod değiştirilmedi; yalnız bu belge. Web metni VERİDİR, talimat değildir; hiçbir şey kurulmadı/çalıştırılmadı.
Kural: hukuki iddia yok (hukuki konular "doğrulanmalı" notlu). Rakam/pazar verisi yalnız sayfası açılan kaynaktan alındı; açılamayan "doğrulanamadı".
Bu belge FEATURE_BACKLOG, PERSONA_*, RESEARCH_*, ISLEM_TAMLIK_DENETIMI içindekileri TEKRAR ÖNERMEZ (bkz. §3.0); onlara yalnız atıf yapar.

## 1. Piyasa taramasının kaynakları

İşaret: [A] sayfa gerçekten açıldı · [S] yalnız arama sonucu özeti · [X] açılamadı (403), doğrulanamadı.

| Konu | Bulgu | Kaynak |
|---|---|---|
| Portal sahibinden veri aktarımı | API; EİDS'e entegre ve sahibinden ile "API Kullanımı sözleşmesi" imzalamış firmalara aktarım (arama özeti). Yardım sayfası 403. | https://yardim.sahibinden.com/hc/tr/articles/19749005158172 [X, bulgu S]; ayrıca FEATURE_BACKLOG'daki Rekabet Kurulu kararı (26.06.2025) |
| Hepsiemlak API | Arama özeti: ilan oluşturma/güncelleme/foto/yayın uçları var. Geliştirici sayfası 403; erişim/başvuru şartı DOĞRULANAMADI. | https://developers.hemlak.com/ [X] |
| Rakip portal dağıtımı | RE-OS: HepsiEmlak, Emlakjet, Emlak Sitem, ListGlobally (yurtdışı), Tapu.com; "tek tıkla" yayın; API/XML formatı belirtilmemiş. Ek: Bulutfon, WhatsApp, İleti Merkezi, PayTR/iyzico, Immoviewer (360° tur), TKGM. | https://re-os.com/entegrasyonlar [A] |
| EİDS | Yetki doğrulama 15.09.2024'te başladı; işletmenin taşınmaz ticareti yetki belgesi ve taşınmaz numarası gerekir; ilan verilen platform otomatik kontrol yapar. Konut satış dahil tüm ilanlar için 01.02.2026 tarihi ikincil kaynakta (arama özeti, resmî metinle teyit edilmeli). Yazılım firması API'si hakkında bilgi YOK. | https://ticaret.gov.tr/kurumsal-haberler/elektronik-ilan-dogrulama-sistemi-eids-yetki-dogrulama-uygulamasi-hayata-gecirildi [A] |
| TKGM / tapu | Parsel sorgulama halka açık ücretsiz web/mobil hizmet (ada/parsel, konum, yüzölçümü, PDF/KML rapor). Programatik/API erişimi hakkında sayfada bilgi YOK: geliştirici API'si varsayılmaz. | https://www.tkgm.gov.tr/e-hizmetler/sik-kullanilanlar/parsel-sorgulama [A] |
| AI sanal staging | sahibinden "SahiDeko": boş/döşeli oda fotoğrafını 4 stilde (modern, İskandinav, rustik, klasik) yeniden tasarlar; Haziran 2025; profesyonel ofis kullanıcılarına, sahibinden kendi R&D'si. | https://www.turkiyeajansi.com/bilim-teknoloji/sahibinden-comdan-emlak-sektorune-yapay-zeka-dokunusu-460306h [A]; genel staging araçları: https://imagen-ai.com/valuable-tips/virtual-staging-ai/ [S] |
| TR AI gerçekçilik | Rakip blogu (ikincil, satıcı yazısı): gerçek değer = müşteri skoru, eşleştirme, fiyat tahmini, ilan optimizasyonu, görüşme özeti; "Türkçe sesli asistan henüz hazır değil", otonom müşteri dönüşümü gerçekçi değil. Blogdaki "%20-25 daha çok görüntülenme" iddiası kanıtsız: KULLANILMAZ. | https://emlakcrmx.com/blog/emlak-crm-yapay-zeka-2026-gercek-kullanim [A] |
| WhatsApp AI kuralı | Genel amaçlı/açık uçlu AI sohbet botları WhatsApp Business Platform'da yasak (yeni hesap 15.10.2025, mevcut 15.01.2026). Yapılandırılmış bot (randevu, bilgi, destek, nitelendirme) serbest; insana yönlendirme gerekir. | https://respond.io/blog/whatsapp-general-purpose-chatbots-ban [A] |
| Doğal dil arama | Zillow "AI mode" (25.03.2026, beta): konuşma biçiminde arama, tur planlama, ajana bağlanma; ayrımcı yönlendirmeyi önleyen guardrail sınıflandırıcı. | https://zillow.mediaroom.com/2026-03-25-Zillow-debuts-AI-mode,-bringing-guided-intelligence-to-every-step-of-the-housing-journey [A] |
| Kira artışı | Eylül 2026 yasal tavan = TÜFE 12 aylık ortalaması, %31,79 (TÜİK 3 Eylül 2026'dan aktarım). | https://tr.euronews.com/2026/09/03/eylul-2026-kira-artis-orani-kiracilar-yeni-orani-bekliyor [A] |
| Kira/e-makbuz | e-SMM sağlayıcıları (Uyumsoft, Paraşüt vb.) var; entegratör hesabı gerekir. | https://www.uyumsoft.com/e-smm [S] |
| Açık bankacılık | TCMB, BKM'nin ÖHVPS 2.0.0 sürümünü devreye aldı: ileri tarihli ve düzenli ödeme emri, kart hareketleri; "53 katılımcı". Katılımcı olma/aggregator koşulları DOĞRULANAMADI. | https://tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Duyurular/Basin/2026/DUY2026-13 [A] |
| Elektronik imza | 5070 sayılı Kanun: güvenli e-imza el yazısı imzayla aynı sonucu doğurur; resmî şekle tabi bazı işlemler e-imzayla yapılamaz. SMS OTP'nin hukuki niteliği bu aramada DOĞRULANAMADI. Hukuki görüş değildir. | https://www.mevzuat.gov.tr/mevzuatmetin/1.5.5070.pdf [A] |
| Gösterme belgesi | Yönetmelik gereği yetkilendirme sözleşmesi, taşınmaz gösterme belgesi ve aracılık sözleşmesi düzenlenmesi bekleniyor (arama özeti; resmî metin açılmadı). | https://aydin.ticaret.gov.tr/yayinlar/kurum-islemleri/tasinmaz-ticareti-yetki-belgesi-islemleri [S] |
| MASAK | Taşınmaz ticaretiyle uğraşanlar MASAK mevzuatında yükümlü; kimlik tespiti, kayıt saklama (genelde 5 yıl), şüpheli işlem bildirimi; emlakçılara özel rehber ve gösterge listesi var. Özet genel; madde/süre/eşikler DOĞRULANMALI. | https://ms.hmb.gov.tr/uploads/sites/12/2025/06/SIB-REHBER-EMLAKCI-2.0-c0f62ab4d5e6620b.pdf [A] |
| Harita/çizerek arama | sahibinden'de çizerek arama var (arama özeti); Hepsiemlak/Zingat birleşti (Zingat kapandı, arama özeti). | bloomberght.com/hepsi-emlak-tan-zingat-hamlesi-2341572 [S] |
| Speed-to-lead | Follow Up Boss ve benzerleri "dakikalar içinde yanıt" üzerine kurulu; blogların rakamları (5 dk = 9x/21x) tutarsız → KULLANILMAZ. | https://www.followupboss.com/integrations/mod-ai-automation [S] |
| Türkçe ses transkripsiyonu | OpenAI dokümanında Türkçe destekli; Türkçe doğruluk/WER verisi bulunamadı (DOĞRULANAMADI). | https://developers.openai.com/api/docs/guides/speech-to-text [S] |

Genel çıkarım: Türk piyasasında ortak vaat = çok portal dağıtımı + CRM + AI ilan metni/değerleme/çeviri + arayan tanıma. Portal dağıtımı ve EİDS TÜRKİYE'DE SÖZLEŞME/RESMÎ ERİŞİM işidir (kod işi değil). Kod ile kazanılacak alan: **uyum, veri girişi sürtünmesi, doğal dil, ilan kalitesi ve ofisin kendi yerel otoritesi**.

## 2. Bizde var / kısmen / yok (dosya kanıtı)

| Piyasa özelliği | Durum | Kanıt |
|---|---|---|
| AI ilan metni (portal/WhatsApp/sosyal/e-posta) | VAR | `src/lib/ai/content.ts` (`ContentKind`), `src/lib/listing-text.ts` (şablon, portal limitleri "tahmin" notlu) |
| AI fotoğraf iyileştirme/staging | YOK (planlı iskelet) | `integrations/registry.ts` `ai_media` status "planned"; yalnız filigran `watermark*.ts`, `property_media.is_cover` |
| AI müşteri asistanı | VAR (ofis içi) | `src/app/app/asistan`, `ai-advisor.ts`, `tenant_advisor_*` tabloları |
| Giden WhatsApp/AI bot | KISMEN | webhook alma `api/webhooks/meta`; `wa.me` linkleri; giden şablon hesap bekliyor (FEATURE_BACKLOG G8) |
| Talep-portföy eşleştirme + bildirim | VAR | `matching.ts`, `match-notify.ts`, cron `vitrin-eslesme`, `vitrin-alarm` |
| Çağrı özeti (AI) | VAR (metinden) | `src/lib/ai/call-summary.ts`; ses→metin YOK (`openai-client.ts` yalnız chat/vision) |
| Doküman OCR (tapu/yetki) | VAR | `src/lib/ai/document-ocr.ts` |
| TKGM/tapu | KISMEN | `tapu-inquiry.ts`, `integrations/tapusor.ts` (üçüncü taraf, anahtar gerek), `registry.ts` "TAKBİS / Tapu" |
| Değerleme/emsal | VAR | `valuation.ts`, `comparables.ts`, `endeksa.ts`, public `degerleme` |
| E-imza | KISMEN | SMS OTP `imza/[token]`, `otp-hmac.ts`; nitelikli/mobil imza YOK |
| Portal yayını (sahibinden/hepsiemlak/emlakjet) | YOK (iskelet) | `integrations/portals/index.ts`; resmî sözleşme yok |
| Kira (tahakkuk, TÜFE, artış) | VAR | `rent_charges`, cron `kira-tahakkuk`, `tufe.ts`, `kira-artis` |
| e-fatura/e-makbuz | İSKELET | `efatura.ts` |
| PWA/push | VAR (derinlik sınırlı) | `sw-register.tsx`, `push.ts`, `push_subscriptions`; çevrimdışı yok (bilinçli, fail-closed) |
| 360° sanal tur | KISMEN | `property_media` türü `tour`/`video` (bağlantı); kendi üretim YOK (doğru: Immoviewer vb. dış) |
| Harita tabanlı arama | KISMEN | `property-map.tsx` (tek ilan konumu), `portfoyler/map-view.tsx`; çizerek arama YOK |
| Doğal dil arama | YOK | `src` içinde yok; vitrin `saved-search-box.tsx` yapılandırılmış filtre |
| Referral / ağ | VAR | `referrals`, `tavsiyeler`, `ag` (network_*) |
| Franchise yönetimi | VAR | `src/app/app/franchise`, `branches` |
| KYC / MASAK müşteri tanıma | YOK | `MASAK`/`aml` araması boş; `authority-shield.ts` yalnız yetki kalkanı |
| Ödeme/sanal pos | VAR | iyzico `payment_links`, `api/iyzico`; açık bankacılık YOK |
| Sesli not | YOK | `MediaRecorder`/transcribe araması boş |
| Ofis mahalle pazar kartı (public) | YOK | `region_stats_history` + `bolge-analizi` yalnız ofis içi |
| Alıcı/malik evrak toplama linki | YOK | portal sayfalarında belge yükleme yok (`musteri-portali`, `malik-portali`); `customer_files` yalnız personel |
| Foto kalite denetimi | YOK | `property-health.ts` alan doluluğuna bakar, görüntüye bakmaz (doğrulanmalı) |

## 3. Fark yaratan öneriler

### 3.0 Zaten belgelenmiş (tekrar önerilmiyor; yalnız öncelik notu)
- Dijital yer gösterme tutanağı/belgesi (FEATURE_BACKLOG #7, G11): yönetmelik dayanağı güçlü (§1); `contracts.ts` `yer_gosterme` türü ve e-imza altyapısı hazır → öncelik YÜKSEK kalsın.
- Yetki belgesi/EİDS bitiş takibi (backlog #4, PERSONA_OFIS_SAHIBI #2), lead hız SLA (backlog #6), içe aktarma genişletme (#5), WhatsApp gelen kutusu (#9), özel alanlar (#10), portal paket dışa aktarma (#12), ilan çevirisi (G14, parite), malik haftalık özet / randevu erteleme / alıcı teklif (PERSONA_MUSTERI), kiracı portalı (PERSONA_MUSTERI #8). Bu belgeden çıkarılmıştır.

### 3.1 Uygulanabilir öneriler (kod + mevcut altyapı + ücretsiz/ucuz)

**F1. MASAK uyumlu müşteri tanıma defteri ("Kimlik tespiti ve işlem kayıt defteri")**
- Ne: Anlaşma/kapora öncesi müşteri bazında "kimlik tespiti yapıldı" kaydı (tür, belge sayısı/görüldü bayrağı, tarih, yapan kişi, ödeme şekli: banka/nakit), işlem başına gösterge kontrol listesi (§1 MASAK rehberindeki göstergelerden: yüksek tutar, nakit, kimlikten kaçınma, hızlı art arda alım-satım, gerçek alıcıyı gizleme), saklama süresi sayacı (süre DOĞRULANMALI, ofis ayarı), eksik kayıtlı anlaşmalar için uyarı, kayıt defteri dışa aktarımı. Bildirim MASAK'a SİSTEMDEN GİTMEZ: ofis kendi yükümlülüğüyle yapar; ekran bunu açıkça söyler.
- Kime: ofis sahibi/uyum sorumlusu. Değer: denetim ve ceza riskini azaltır; "yetkili" değil "kayıtlı" olma güvencesi.
- Neden fark: Taramada hiçbir Türk emlak CRM'inin bu özelliği doğrulanamadı (RESEARCH_TR_CRM de uyum alanında yetki/KVKK/İYS sayıyor, MASAK yok). "Yok" diye pazarlanmaz (doğrulanmadı), "uyum karnesine eklenmiş" denir.
- Oturma: `compliance` modülü (yeni modül AÇILMAZ; 4 kayıt yeri atlanır), `/app/uyum` altına sekme; `deals`/`customers` kartında rozet. Yeni tablo `aml_cdd_records` (tenant_id, customer_id, deal_id nullable, kimlik_turu, belge_goruldu, odeme_sekli, gosterge_isaretleri jsonb, kaydeden, saklama_bitis). TC kimlik NO TUTULMAZ (yalnız "görüldü" + son 4 hane isteğe bağlı) → KVKK riskini azaltır. Mükerrer: `authority-shield.ts`, `deal-checklist` (ofis kontrol listesi) ile ortak "anlaşma kapısı" kullanır; `deal_checklist_items` yeni madde olarak "Kimlik tespiti" eklenebilir (tekrar tablo yok ise o yol tercih; karar bkz. paket A).
- Dış bağımlılık: yok. Risk: hukuki kapsam; metin "hukuki danışmanlık değildir; yükümlülük kapsamını mali müşavir/avukatla doğrulayın" + son doğrulama tarihi (backlog (i) kuralı). Şema: EVET. Efor: M. Etki: yüksek (güven + satış argümanı).

**F2. Doğal dil motoru: "yazdığını anlayan" arama ve hızlı kayıt (tek çekirdek, iki yüzey)**
- Ne: (a) Vitrinde ve /app'te tek kutu: "Kadıköy'de 5 milyon altı asansörlü 3+1 kiralık" → yapılandırılmış filtreye çevirir, kullanıcı çipleri görür/düzeltir, mevcut URL searchParams kontratıyla liste açılır. (b) `/app/hizli` içinde "Metinden kayıt": danışman WhatsApp mesajını/ klavye dikte (telefonun kendi mikrofonu) ile yazdığı notu yapıştırır → müşteri + talep + görev TASLAĞI; her alan düzenlenebilir, kaydetmek kullanıcı onayıdır.
- Kime: alıcı (vitrin), danışman (sahada hız). Değer: form doldurma sürtünmesi (PERSONA_DANISMAN İ3) ve filtre karmaşası.
- Neden fark: Zillow AI mode doğal dil arama/aksiyon sunuyor [A]; Türk portallarda doğal dil arama bulunamadı (doğrulanmadı); RE-OS/EmlakCRMx "görüşme notunu yapılandırma" iddia ediyor (ikincil). Sesli not için sunucu ses işlemi GEREKMEZ: telefon klavyesi dikte eder (Türkçe ses transkripsiyonu doğruluğu doğrulanamadı → bilinçli kaçınma).
- Oturma: `src/lib/ai/nl-parse/` (şema + izinli alan beyaz listesi; çıktı Zod ile doğrulanır; il/ilçe `geo_*` tablosuyla eşlenir, eşleşmeyen alan atılır, UYDURMA YOK), çağrı yalnız `openai-client.ts` + `redact.ts`; vitrin için anonim, hız sınırlı (`rate-limit.ts`), kişisel veri girilirse reddet. `hizli/quick-capture.tsx` mevcut sunucu eylemlerini kullanır. Guardrail: ayrımcı yönlendirme (Zillow Fair Housing örneği) → ayrıştırıcı yalnız mülk/bütçe/konum alanlarını çıkarır, "kimlere satılmaz" gibi ifadeleri yok sayar.
- Dış bağımlılık: OpenAI (mevcut). KVKK: serbest metin kişisel veri taşıyabilir → redact + kaydetmeden önce kullanıcı onayı; metin loglanmaz. Şema: gerekmez. Efor: M. Etki: yüksek.

**F3. Fotoğraf kalite denetçisi (ücretsiz, deterministik) + kapak/sıra önerisi**
- Ne: Portföy fotoğraflarında `sharp` ile ölçülebilir kontroller: çözünürlük, en-boy, bulanıklık (Laplace varyansı), pozlama (histogram), yatay/dikey, tekrar eden görsel (hash). Çıktı: "5 fotoğraftan 2'si düşük çözünürlük; kapak için en keskin ve en aydınlık: #3" + portal için asgari sayı uyarısı (portal eşikleri DOĞRULANMADI, ofis ayarı). İsteğe bağlı: görsel model ile oda türü etiketi (mevcut `getOpenAiVisionModel`), yüz/plaka gizleme uyarısı.
- Kime: danışman, ofis sahibi (ilan kalitesi, PERSONA_OFIS_SAHIBI İ5). Neden fark: SahiDeko gibi portal araçları görseli DEĞİŞTİRİR [A]; kalite denetimi/kapak seçimi rakip ürünlerde doğrulanmadı. Sahte skor yok: her uyarı ölçülen eşikle açıklanır (kural tabanlı ve öyle etiketlenir).
- Oturma: `src/lib/media-quality/` saf fonksiyonlar (vitest ile test edilebilir), `property_media` okunur (storage erişimi mevcut `property-media-access.ts` kuralıyla), `property-health.ts`'e bir "görsel" boyutu eklenir. Dış bağımlılık yok (sharp zaten bağımlılık). Şema: v1 yok (anlık hesap; önbellek gerekirse sonra). Efor: S-M. Etki: orta-yüksek.

**F4. Evrak toplama linki (token'lı) + tapu görselinden portföy ön-doldurma**
- Ne: Danışman malike/müşteriye "evrak iste" linki gönderir (tapu fotokopisi, yetki sözleşmesi imzalı hali, vekâletname…); karşı taraf telefonundan yükler; danışmanın portföyünde "eksik evrak" listesi dolar; tapu görseli için MEVCUT `document-ocr.ts` ile ada/parsel/alan ÖNERİSİ gelir, danışman onaylar.
- Neden fark: PERSONA_MUSTERI "malik portalında belge yok" saptıyor; rakipte token'lı evrak toplama doğrulanmadı. Danışmanın en sık zaman kaybı (WhatsApp'ta evrak kovalama) → tek link, otomatik hatırlatma (mevcut otomasyon/push).
- Oturma: yeni public rota `src/app/evrak/[token]/`, `owner_portal_tokens` desenini ve `direct-file-upload-*.ts` yükleme hattını yeniden kullanır; yeni tablo `document_requests` (tenant_id, property_id/customer_id, istenen_tur[], token_hash, expires_at, durum). Mükerrer: `malik-portali` (aynı token ailesi olabilir; ayrı tutulur, çünkü yükleme yazma izni içerir), `belgeler`/`customer_files`.
- KVKK/güvenlik: KİMLİK görseli OCR'a GÖNDERİLMEZ (yalnız tapu/yetki); yükleme türü/boyutu `file-validation.ts`; token süreli, iptal edilebilir, hız sınırı; aydınlatma metni linkte. Şema: EVET. Efor: M. Etki: yüksek (günlük sürtünme).

**F5. Ofis "Mahalle pazar notu" — vitrinde yerel otorite sayfası (opt-in, n eşikli)**
- Ne: Ofisin KENDİ ilan/satış verisinden (ve mevcut `region_stats_history`) mahalle bazlı: aktif ilan sayısı, medyan liste m² fiyatı, ortalama satış süresi (yalnız n ≥ eşik olunca gösterilir; aksi halde sayfa üretilmez), fiyat değişim yönü; "bu ofisin verisine göre" etiketi + güncelleme tarihi. Vitrinde indekslenebilir sayfa + JSON-LD (mevcut `vitrin-og.tsx` ve `landing-jsonld.tsx` desenleri), "evim ne kadar eder" huniyle bağlı.
- Kime: ofis sahibi (pazarlama, İ10), alıcı/satıcı. Neden fark: ilan portalları genel pazar verisini kendi ürünü yapar; ofisin yerel otoritesini büyüten otomatik içerik rakipte doğrulanmadı. Sahte metrik riski: küçük örneklem → eşik + n gösterimi ZORUNLU, sektör ortalaması KULLANILMAZ.
- Oturma: `src/app/vitrin/[slug]/pazar/[...]` yeni rota, `src/lib/market-card/` saf hesap, tenant opt-in ayarı (küçük kolon veya `definitions`), `sitemap.ts` tek satır. Dış bağımlılık yok. KVKK: yalnız toplulaştırılmış veri; adres/sahip bilgisi yok. Şema: küçük (opt-in alanı). Efor: M. Etki: orta (SEO uzun vadeli, ölçüm ofis başına doğrulanmalı; "X% trafik" vaadi YOK).

**F6. "Yorumu Google'a taşı" köprüsü (anket sonrası)**
- Ne: Anlaşma sonrası memnuniyet anketinde yüksek puan veren müşteriye ofisin Google yorum bağlantısı gösterilir; düşük puanda sahibe uyarı (PERSONA_OFIS_SAHIBI #11 ile aynı veriyi kullanır). Puan ŞARTLI yönlendirme platform politikalarına aykırı olabilir (review gating) → tüm müşterilere linki göster, düşük puan ek olarak sahibe gitsin (hukuki/politika doğrulanmalı).
- Neden: yerel itibar, sıfır dış bağımlılık. Fark: orta/düşük (rakipte doğrulanmadı ama küçük). `src/app/anket/[token]` mevcut. Şema: ofis URL alanı (tenant ayarı). Efor: S. Etki: orta-düşük; paketlenmedi (backlog "hızlı kazanım").

**F7. Kiracı adayı başvuru dosyası (puansız)**
- Ne: Kiralık ilana ilgi duyan aday için token'lı başvuru formu (kimlik adı, meslek/çalışma durumu beyanı, kefil var/yok, evrak yükleme — F4 altyapısıyla); ofis tarafında karşılaştırmalı dosya görünümü ve ev sahibine "özet paylaş" linki. Skor/ret önerisi YOK (ayrımcılık ve KVKK riski; Zillow örneği guardrail gerektirir).
- Fark: kiralama yoğun TR ofislerinde günlük iş; rakiplerde doğrulanmadı. Bağımlılık F4'e (aynı yükleme hattı); sonraya bırakıldı. Şema: EVET. Efor: M. KVKK: gelir/meslek beyanı özel hassasiyet → saklama süresi ve aydınlatma zorunlu.

### 3.2 "Sahibin kararı gerekir" listesi (ağır/onay/ücretli/hukuki)
| # | Konu | Neden karar gerekli |
|---|---|---|
| K1 | sahibinden API (veri aktarımı) | API Kullanımı sözleşmesi + EİDS entegrasyonu şartı (arama özeti); resmî başvuru sahibin işi. Anahtar/sözleşme olmadan kod yazılmaz. |
| K2 | Hepsiemlak/Emlakjet API | Erişim şartı DOĞRULANAMADI (geliştirici sayfası 403). Ticari görüşme gerekir. |
| K3 | Meta WhatsApp Business hesabı + giden bot | Hesap/şablon onayı; bot yapılandırılmış olmalı (açık uçlu AI yasak, [A]); insana devir şart. |
| K4 | AI sanal staging/video sağlayıcısı | Ücretli sağlayıcı API'si; üretilmiş görselin ilanda "sanal döşeme" etiketlenmesi ve portal kuralları DOĞRULANMADI (hukuki/ToS). |
| K5 | Ses → metin (sunucu tarafı) | Kişisel veri içeren ses OpenAI'ye gider: aydınlatma, yurt dışına aktarım, saklama kararı; Türkçe doğruluk verisi yok. Ara çözüm F2 (telefon dikte). |
| K6 | Açık bankacılık (kira/komisyon tahsilat eşleme) | ÖHVPS katılımcısı olma veya lisanslı aggregator gerekir; koşullar DOĞRULANAMADI; mali lisans/sorumluluk. |
| K7 | e-SMM/e-fatura entegratörü | Entegratör hesabı + muhasebe sorumluluğu; mevcut `efatura.ts` iskelet kalmalı, vaat yok. |
| K8 | Nitelikli/mobil e-imza | Hizmet sağlayıcı sözleşmesi; hangi belgenin hangi imzayla geçerli olacağı hukuki görüş ister (5070 §, SMS OTP niteliği DOĞRULANAMADI). |
| K9 | Kimlik doğrulama (KYC) servisi (NVI vb.) | Kimlik Paylaşım Sistemi gibi resmî servislere erişim kurum başvurusu ister; erişim koşulu DOĞRULANAMADI. F1 elle kayıtla başlar. |
| K10 | TKGM canlı sorgu | Halka açık parsel sorgulama sitesi var, API erişimi sayfada yok [A]: kazıma YAPILMAZ; resmî erişim yoksa elle/üçüncü taraf (`tapusor`) kalır. |
| K11 | MASAK kapsam metni (F1 için) | Yükümlülük kapsamı, saklama süresi ve gösterge listesinin hukukçu/mali müşavirle teyidi. |

## 4. Uygulama paketleri (dosya sahipliği çakışmasız)

Ortak kurallar: yeni klasör/dosya; mevcut dosyaya yalnız belirtilen TEK satırlık entegrasyon; `nav-config.ts`'e tek satır (mevcut bir `module` ile, yeni modül açılmaz); migration forward-only + `check:migrations`; OpenAI yalnız `openai-client.ts` + `redact.ts`; `createAdminClient` kullanılırsa allowlist güncelle; zaman `clock.ts`; telefon/e-posta `PhoneInput`/`EmailInput`; her sayı tıklanabilir; PostgREST gömmelerinde FK adı.
Çalışan başka ajanların alanlarına (`admin`, `app/{musteriler,talepler,...,onaylar}`) DOKUNULMAZ: bu alanlardaki bağlantı noktaları paket sonunda ayrı "entegrasyon commit"i olarak birleştirme ajanına bırakılır.

### Paket A — MASAK müşteri tanıma defteri (F1) · M
- Sahiplik: `supabase/migrations/<yeni>_aml_cdd_records.sql`, `src/lib/aml/**`, `src/app/actions/aml-records.ts`, `src/app/app/uyum/musteri-tanima/**` (uyum klasörü başka ajanda değil; `uyum/page.tsx` DOKUNULMAZ), testler.
- Yapılacaklar: tablo + RLS (`current_tenant_id()`), `requirePermission("compliance", ...)`, defter listesi (filtreli, sayfalı), kayıt formu (tek sayfa), gösterge kontrol listesi sabitleri tek dosyada (kaynak: rehber; "doğrulanmalı" notlu), saklama bitişi hesabı (ayar değeri, varsayılan "ofis belirler"), eksik kayıtlı kapora/anlaşma sayacı (tıklanınca filtreli liste), CSV dışa aktarım (mevcut export desenine denetim logu).
- Entegrasyon noktası (sonra): `uyum` sayfasına sekme linki; `deal-checklist-templates.ts`'e "Kimlik tespiti" maddesi.
- Kabul: TC kimlik no saklanmaz (test ile sabitlenir); RLS audit temiz; her ekranda "hukuki danışmanlık değildir + son doğrulama tarihi"; tip/lint/test yeşil; yetkisiz rol erişemez.

### Paket B — Doğal dil motoru (F2) · M
- Sahiplik: `src/lib/ai/nl-parse/**` (şema, beyaz liste, prompt, test), `src/app/actions/nl-search.ts`, `src/app/actions/nl-intake.ts`, `src/components/public/nl-search-box.tsx`, `src/components/app/nl-intake-panel.tsx`, `src/app/app/hizli/metinden/**`.
- Yapılacaklar: ayrıştırıcı çıktısı Zod + geo eşleme + bütçe/oda doğrulama; vitrin kutusu çip önizleme + URL parametresi üretimi (mevcut filtre kontratı); anonim çağrıya `rate-limit.ts` + günlük tavan + AI yoksa zarif gerileme (kutu gizlenir, mevcut filtreler çalışır); "Metinden kayıt" taslak ekranı (düzenle → mevcut `customers`/`demands` eylemlerini çağır, yeni yazma yolu AÇMA).
- Entegrasyon (sonra, tek satır): vitrin liste sayfasına kutu import'u; hizli sayfasına sekme.
- Kabul: kişisel veri maskesiz OpenAI'ye gitmez (sözleşme testi geçer); modelin uydurduğu alan beyaz liste dışı ise atılır (birim test); örnek 15 Türkçe cümle için beklenen filtre tablosu testte; çıktı kaydı kullanıcı onayı olmadan yazılmaz.

### Paket C — Fotoğraf kalite denetçisi (F3) · S-M
- Sahiplik: `src/lib/media-quality/**`, `src/app/actions/photo-quality.ts`, `src/components/app/photo-quality-panel.tsx` (+ testler, sentetik görsel fixture'ları).
- Yapılacaklar: saf ölçüm fonksiyonları (çözünürlük, bulanıklık, pozlama, hash çiftleri), eşikler tek dosyada ve "tahmin/ayarlanabilir" etiketli, kapak/sıra önerisi (otomatik UYGULAMAZ, öneri), `property-media-access.ts` ile yetkili okuma, panel bileşeni.
- Entegrasyon (sonra): `portfoyler/[id]` medya sekmesine panel import'u (portfoyler başka ajanda → birleştirme ajanı); `property-health.ts` boyutu.
- Kabul: aynı görsel aynı sonuç (deterministik); her uyarı ölçülen değerle açıklanır; sahte skor yok; büyük görselde bellek/zaman sınırı; test fixture ile bulanık/karanlık yakalanır.

### Paket D — Evrak toplama linki + tapu ön-doldurma (F4) · M
- Sahiplik: `supabase/migrations/<yeni>_document_requests.sql`, `src/lib/doc-request/**`, `src/app/actions/document-requests.ts`, `src/app/evrak/[token]/**` (public), `src/app/app/evrak-talepleri/**` (personel listesi/oluşturma).
- Yapılacaklar: token üretimi (hash'li saklama), süre/iptal, hız sınırı, yükleme (mevcut doğrudan yükleme hattı + `file-validation.ts`), "eksik evrak" durumu, tapu görseli → `document-ocr.ts` önerisi (yalnız tapu/yetki türü; kimlik türünde OCR kapalı), personel onayıyla portföy alanlarına aktarım, hatırlatma için mevcut otomasyon/notify.
- Entegrasyon (sonra): `nav-config.ts` tek satır (Portföy başlığı, `module: "properties"`), portföy kartında "evrak iste" düğmesi.
- Kabul: public rota `noindex`, tenant aktiflik kontrolü (mevcut `public-tenant.ts`), token iptali yükleme yolunu kapatır; yüklenen dosya yalnız ilgili tenant'ta okunur (RLS + `private-download` sözleşme testleri); OCR sonucu onaysız yazılmaz; RLS audit temiz.

### Paket E — Mahalle pazar notu (F5) · M
- Sahiplik: `src/app/vitrin/[slug]/pazar/**`, `src/lib/market-card/**` (hesap + n eşiği + testler), opt-in ayar için migration.
- Yapılacaklar: saf hesap (medyan, n eşiği, güncelleme tarihi), eşik altı mahallede sayfa üretilmez (404), `generateMetadata` + JSON-LD, tenant opt-in; kaynak etiketi "bu ofisin verisine göre"; tıklanınca filtreli ilan listesi.
- Entegrasyon (sonra, tek satır): `sitemap.ts` girdisi; vitrin ilan detayından "mahalle notu" bağlantısı (Paket B ile aynı vitrin dosyasına dokunma riski: B yalnız liste sayfası, E yalnız detay/rota; çakışma varsa birleştirme ajanı sıralar).
- Kabul: n < eşikse hiçbir sayı gösterilmez (birim test); sektör ortalaması/harici rakam yok; adres/sahip verisi sızmaz; opt-in kapalıyken rota 404; public smoke e2e'ye eklenir.

(Sıra önerisi: A ve D bağımsız ilk dalga; B ikinci; C hızlı kazanım olarak her an; E son. F6/F7 paket dışı: F7, D'nin yükleme hattına bağlı.)

## 5. Yapma listesi (mantıklı görünür, bize uymaz)

1. **Portallardan kazıma veya şifreyle oturum açma** (sahibinden/hepsiemlak/emlakjet): ToS ve hukuki risk; ROADMAP yasaklar. Resmî API ancak sözleşmeyle (K1/K2).
2. **TKGM parsel sorgusunu otomatik çekmek**: sayfada API/programatik kullanım izni yok [A]; kazıma = yapma.
3. **Kendi AI staging/diffusion modelini barındırmak**: GPU maliyeti ve bakım; SahiDeko portal içi [A]. Ücretli sağlayıcı kararı K4.
4. **Açık uçlu "ChatGPT gibi" WhatsApp müşteri botu**: Meta politikası genel amaçlı botu yasaklıyor [A]; yalnız yapılandırılmış akış, insana devirli.
5. **"AI müşteri skoru / satış olasılığı" pazarlamak**: mevcut skorlar kural tabanlı; sahte skor yasak (CLAUDE.md). F3/F5 de kural tabanlı etiketlenir.
6. **Ses kaydını sunucuya göndererek transkript (şimdi)**: KVKK + doğruluk belirsiz (K5).
7. **Kendi nitelikli e-imza/KYC "doğrulama" vaadi**: hukuki sonuç doğurur; SMS OTP mevcut haliyle kalır, "hukuken geçerli" iddiası yok (K8/K9).
8. **MASAK şüpheli işlem bildirimini sistemden otomatik göndermek**: yükümlü ofistir; bildirim kararı insanındır. F1 yalnız kayıt/hatırlatma.
9. **Rakip/portal "kaç görüntüleme aldı" kazıması**: yasak yol; malike gösterim yalnız ofisin kendi verisinden.
10. **Çizerek harita arama (şimdi)**: sahibinden'de var (S) ama harita kütüphanesi + geo sorgu + vitrin değişikliği büyük (L); F2 doğal dil aynı ihtiyacın %80'ini (mahalle çoklu seçim) ucuza karşılar. Talep gelirse ayrı değerlendirilir.
11. **Kendi 360° tur üretimi**: dış sağlayıcı (Immoviewer vb.) bağlantısı `property_media` `tour` türüyle zaten taşınıyor; üretim bizim işimiz değil.
12. **Hukuki sabitleri sessiz gömmek** (komisyon %, KDV, kira tavanı, MASAK süreleri): kira tavanı (§1: %31,79 Eylül 2026) tek seferlik görülmüş veridir; `tufe.ts` kaynağı ve tarih etiketi olmadan ekrana sabit yazılmaz.
13. **Açık bankacılık/e-SMM'i "yakında" diye vitrine koymak**: K6/K7 kararı verilmeden vaat yok.
14. **Rakip adlı "daha iyi" karşılaştırma tablosu**: doğrulanamaz, fiyatlar değişir.
15. **Çevrimdışı sayfa önbelleği**: `sw.js` fail-closed bilinçli güvenlik kararı; çevrimdışı yalnız yazma taslağı (PERSONA_DANISMAN #6).
