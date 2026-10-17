# EmlakSoft Zeka

Zeka, sistemin her yüzeyinde çalışan yerleşik yapay zekadır. Tek bir çekirdek vardır, dört yüzeye hizmet verir. Bugün **harici API olmadan** çalışır ("yerel zeka"). OpenAI anahtarı eklenince **kod değişmeden** GPT ile çalışır. Bu durumda da veriyi aynı yetkili araçlarla okur.

## Yüzeyler ve veri sınırları

| Yüzey | Giriş | Uç nokta | Veri sınırı | GPT ölçümü |
|---|---|---|---|---|
| Ofis paneli (`app`) | Her `/app` sayfasında yüzen "Zeka'ya sor" düğmesi (Ctrl J), ana ekrandaki "Ne yapmak istiyorsun?" kutusu, komut paletindeki (Ctrl K) "Zeka'ya sor" satırı | `POST /api/zeka` | Oturum ve RLS. Ek olarak etkin izin, kapalı modül, liste kapsamı (kendi/takım/şube) ve `earnings_all` | Ofis AI kredisi (`canAutoCallAi` kapısı) |
| Platform sitesi (`public`) | Ana sayfa kahramanındaki küçük kutu; ana sayfa (özellikler dahil), fiyatlar, site sayfaları, araçlar ve rehberde yüzen "Zeka'ya sor" düğmesi (pencere başlığı "EmlakSoft'a sor") | `POST /api/zeka/genel` | Yalnız herkese açık içerik: paket ve fiyat, site sayfaları, SSS, rehber, sözlük, onaylı soru-cevap | Platform AI kotası (`zeka.public`) |
| Vitrin (`vitrin`) | Vitrinde yüzen "Zeka'ya sor" düğmesi (pencere başlığı "İlan asistanı") | `POST /api/zeka/vitrin` | Yalnız o ofisin yayındaki ilanları (`vitrin_listing_search`) | Ofis AI kredisi. Ayrıca ofisin "vitrin sohbet asistanı" ayarı açık olmalı (varsayılan kapalı) |
| Yönetim (`admin`) | Her `/admin` sayfasında yüzen "Zeka'ya sor" düğmesi (Ctrl J), yönetim ana ekranındaki komut çubuğu | `POST /api/zeka/yonetim` | Salt okunur platform özeti (`buildAdvisorContext`, yalnız `advisor` modülüne). Personelin görebildiği menü | Platform AI kotası (`zeka.admin`) |

**Zeka hiçbir iş kaydı yazmaz.** "Oluştur" isteği yalnız ön doldurulmuş bir form bağlantısı üretir (örnek: `/app/randevular/yeni?customer=…&tarih=…&saat=…`). Kayıt, kullanıcı formu açıp kaydettiğinde mevcut kapılı action ile oluşur. Vitrinde talep, ziyaretçi mevcut talep formunu kendisi gönderdiğinde oluşur. Bu kural `zeka-engine.test.ts` içindeki "ASLA YAZMAZ" sözleşmesiyle kilitlidir. Zeka'nın yazdığı tek veri, kişisel verisi maskelenmiş sorgu günlüğüdür.

## Mimari

```
src/lib/ai/zeka/
  types.ts           ZekaResult, ZekaCard, ZekaAction, ZekaEngine arayüzü
  context.ts         Çok turlu bağlam: geçmişi katlar, takip sorusunu tanır, önceki turun yuvalarını birleştirir
  policy.ts          Yönetici davranışı: kişilik, yüzey istemi eki, yasaklı konular, yanıt dili (sistem istemi kurulumu)
  limits.ts          Günlük kişi/ofis soru sınırları (24 saatlik pencere)
  starters.ts        Sayfaya ve role göre başlangıç soruları (yüzen pencere)
  center.ts          Yapay zeka merkezi sekmeleri ve sekme başına yazılabilir ayar listesi
  normalize.ts       Türkçe katlama, kesme işaretli ek atma, kök (stemTr), ön ek eşleşmesi
  lexicon.ts         Varlıklar ve eş anlamlıları (müşteri, portföy/ilan, talep, randevu, görev, anlaşma, teklif, sözleşme,
                     kira, aidat, gelir/gider, komisyon, kampanya, ekip/danışman, rapor), durum ve niyet ipuçları
  slots.ts           Yuvalar: oda, fiyat, ilçe (nl-search ayrıştırıcısı yeniden kullanılır), tarih/saat, dönem, telefon,
                     portföy kodu, kişi adı, tutar
  intent.ts          Niyet: navigate / search / create / data / howto / report / unknown (kural tabanlı, gerekçeli)
  metrics.ts         Sayı soruları kataloğu: modül, earnings_all, ofis kapsamı, filtreli liste bağlantısı
  scope.ts           Kullanıcı kapsamı (izin, kapalı modül, paket kilidi, kazanç gizliliği)
  tools.ts           ARAÇ SETİ (iki motor ortak): search_records, count_metric, prepare_create, navigate, help_lookup
  port-supabase.ts   Salt okunur veri kapısı (kullanıcı istemcisi + getListScope; service_role yok)
  local-engine.ts    Yerel zeka (uygulama)
  gpt.ts             GPT araç döngüsü (openai-client üzerinden, en çok 2 araç turu)
  app.ts             Uygulama orkestrasyonu: ayar → motor seçimi → GPT hatasında yerel motor → günlük
  settings.ts        Ayar okuyucu ve motor seçimi (`chooseEngine`)
  log.ts             Kişisel verisiz günlük (`redact.ts`) ve olumlu/olumsuz geri bildirim
  embeddings.ts      Sorgu vektörü (yalnız GPT kurulumunda)
  client.ts          İstemci yardımcıları (bağımlılıksız): fetch, son sorgular
  knowledge/         Bilgi katmanı: chunks.ts (koddan parçalar), bm25.ts, base.ts (KnowledgeBase), store.ts, index-job.ts
  surfaces/          public.ts, vitrin.ts (+ vitrin-server.ts), admin.ts, serve.ts (ortak orkestrasyon)
src/components/zeka/ zeka-panel.tsx (tembel parça: komut çubuğu paneli ZekaPanel + sohbet penceresi ZekaDock, ortak yanıt gövdesi),
                     zeka-fab.tsx (yüzen düğme, küçük ada), zeka-fab-slot.tsx (/app ve /admin kabuk yuvası),
                     public-ask.tsx (ana sayfa kahraman kutusu), public-launcher.tsx (public ve vitrin yüzen düğme)
src/app/api/zeka/    route.ts (app), genel/, vitrin/, yonetim/, geri-bildirim/
src/app/admin/zeka/  Yapay zeka merkezi (sekmeler: Bağlantı, Yüzeyler, Davranış, Bilgi, Kullanım, Kayıtlar)
```

### Bilgi katmanı ("her şeyi öğrenmeli")

Parçalar elle tutulan kopyalardan üretilmez; doğrudan koddaki tek kaynaklardan gelir:

- Rota ve özellik grafiği: `nav-config.ts` (bölüm, öğe, sekme ve eş anlamlılar) ve paletin menü dışı sayfaları.
- Oluşturma eylemleri ve ön dolgu parametreleri: `palette-core.ts` APP_ACTIONS ve `prefill-params.ts` sözleşmesi.
- Niyet sözcükleri: `palette-core.ts` PALETTE_INTENTS.
- Yardım: `help-faq.ts`, `help-content.ts` (rehber ve sözlük) ve yardım merkezinin yayınlanmış DB makaleleri (`getHelpContent`).
- Terminoloji: `terms.ts`.
- Paket ve fiyat (public): canlı katalog `getPublicPricing`. Site sayfaları: SEO envanteri. Ana sayfa SSS'si.
- Yönetim: yönetim menüsü (`admin/nav.ts`) ve ayar açıklamaları (registry).
- Onaylı soru-cevaplar (`zeka_qa`): yönetici Yapay zeka merkezinde (Bilgi ve Kullanım sekmeleri) ekler.

Parçalar sürümlüdür (`knowledgeVersion`, içerik özeti). Arama yöntemi kuruluma bağlıdır:

- **Anahtarsız kurulum:** BM25 sözcüksel arama, Türkçe kök desteğiyle.
- **Anahtarlı kurulum:** gömme vektörü (kosinüs) ile BM25 birlikte kullanılır (`hybridScores`).

Yetki süzgeci aramadan önce uygulanır. Kullanıcının göremediği modülün parçası hiçbir motorun bağlamına girmez.

### Öğrenme döngüsü

1. Her yanıt `zeka_query_log` tablosuna yazılır: maskelenmiş metin (en çok 300 karakter), niyet, motor, güven, yanıtlandı mı, düşüş nedeni.
2. Panelde "Yanıt işinize yaradı mı?" sorusu olumlu/olumsuz oy toplar (`/api/zeka/geri-bildirim`; satır başına bir kez, 24 saat içinde).
3. Yapay zeka merkezi Kullanım sekmesi (`/admin/zeka?sekme=kullanim`) şunları gösterir: seçilen dönemin sayaçları (niyete, motora, yüzeye ve ofise göre) ve en çok sorulan cevapsız, düşük güvenli ya da beğenilmeyen sorgular. Yönetici bu sorgulara onaylı yanıt ekler.
4. Onaylı yanıtlar iki motorun da bilgi tabanına girer (süreç içi önbellek boşaltılır).
5. Gece bakımı (`/api/cron/olcum-bakim`, ikinci adım `runZekaIndex`) anahtar varsa yalnız içeriği değişen parçaları yeniden gömer. Silinen parçalar dizinden çıkar.

## Yüzen "Zeka'ya sor" düğmesi

- Yerleşim: `/app` ve `/admin` layout'larının görünmez kabuk parçasına (`ShellBoot`) tek satır `ZekaFabSlot`; public sayfalarda
  `SiteFooter` ve `PricingShell` içindeki `ZekaPublicLauncher`; vitrinde `ZekaVitrinLauncher`. Yüzey yönetimden kapalıysa düğme çizilmez.
- Tembel yükleme: ilk yüke yalnız düğme (satır içi SVG, birkaç satır CSS) girer. Sohbet penceresi (`ZekaDock`, `zeka-panel.tsx`)
  ilk tıkta ya da Ctrl J ile iner; üstüne gelince/odakta önceden indirilir. Sözleşme: `src/components/zeka/zeka-fab-contract.test.ts`.
- Sayfa bağlamı `usePathname` ile gelir (arama parametresi okunmaz). Başlangıç soruları `starters.ts` (ör. `/app/portfoyler`:
  portföy soruları; danışmana ciro/sıralama sorusu önerilmez). Yol sunucuya `page` olarak gider (yalnız GPT bağlamı).
- Çakışma kuralları (`zeka-fab.css`): `--mobile-nav-offset` / `--mbar-h` payının üstünde durur; form kaydet çubuğu ve mobil eylem
  çubuğu varken üste çıkar; ekran klavyesi açıkken gizlenir; bildirim (toast), "yeni sürüm" çubuğu, PWA kartı, NPS anketi ve görüşme
  sonucu paneli görünürken çekilir; public mobil alt çağrı çubuğunun üstünde durur.
- Sohbet: pencere açıkken konuşma sürer. Her soru son 3 soruyla (`history`) gider. "Yeni konuşma" düğmesi geçmişi siler.

## Çok turlu bağlam ("bunlardan kaçı kiralık?")

Sunucu durumsuzdur. İstemci aynı konuşmanın son 3 sorusunu gönderir, sunucu bunları sırayla yeniden çözer (`context.ts buildCarry`).
Yeni soru takip sorusuysa (gönderme sözcüğü "bunlardan/onlar/kaçı/olanlar", "peki/ya", ya da varlık adı geçmeyen kısa süzgeç sorusu
"geçen ay?", "Beşiktaş'ta?"), eksik yuvalar (varlık, bölge, oda, fiyat, işlem türü, dönem, durum, kişi) önceki turdan tamamlanır.
Belirsiz niyet önceki turun veri/arama niyetini sürdürür. Yeni sorunun kendi yuvası her zaman kazanır. Takip olmayan soru ("ayarlar")
bağlam almaz. Yetki her turda araçlarda yeniden uygulanır: önceki tur yetki dışı veri taşıyamaz. GPT kipinde önceki sorular sistem
istemine ayrı satır olarak girer. Vitrin de aynı birleştirmeyi kullanır. Testler: `src/lib/ai/zeka/zeka-context.test.ts`.

## Kurulum: OpenAI anahtarını eklemek (kod değişikliği yok)

1. **Yönetim > AI & entegrasyon > Yapay zeka merkezi > Bağlantı** (`/admin/zeka`) sekmesinde "OpenAI anahtarı" alanına `sk-…`
   anahtarını girip **Kaydet**'e basın (yalnız süper admin). Anahtar şifreli saklanır (`ai.openai_api_key`, `PLATFORM_SECRETS_KEY`
   gerekir) ve hiçbir ekranda gösterilmez; ekranda yalnız durum, kaynak ve parmak izi görünür. Aynı alan
   Sistem > Entegrasyonlar'da da vardır. Ortam değişkeni `OPENAI_API_KEY` yedektir.
2. Aynı sekmede isterseniz **Model** alanına model adını yazın (boş = `OPENAI_MODEL`, yoksa gpt-4o-mini) ve kaydedin.
3. **Bağlantıyı test et**'e basın. Tek, en küçük çağrı yapılır (platform kotası `zeka.admin`); sonuç ve süre (ms) görünür, yanıt
   içeriği gösterilmez. "Başarısız" ise mesaj nedeni söyler (anahtar reddedildi, model erişimi yok, kota, ağ).
4. Kip varsayılan olarak **otomatik**tir: anahtar kaydedildiği an her yüzey GPT ile yanıtlar. Anahtar yoksa, GPT hata verirse ya da
   kota dolarsa yanıtı yerel zeka verir; panelde "Yerel zeka" rozeti görünür. Yüzey bazında kip **Yüzeyler** sekmesindedir.
5. **Bilgi** sekmesinde **Yeniden oluştur**'a basın: bilgi tabanı tazelenir ve anlamsal dizin hemen kurulur (yoksa gece bakımı
   `/api/cron/olcum-bakim` kurar). Bundan sonra arama melez (sözcüksel + anlamsal) çalışır.
6. Öğrenme tabloları için `supabase/migrations/20261024010000_zeka_learning.sql` uygulanmış olmalıdır (pencere ZK1). Bu dosya yokken de
   Zeka çalışır, yalnız günlük, soru-cevap ve dizin katmanları atlanır.
7. İsteğe bağlı platform kotası: `platform_settings` içinde `zeka.public`, `zeka.admin` ve `zeka.index` anahtarlarına
   `{"monthlyLimit": N}` yazılırsa ilgili platform çağrıları aylık N ile sınırlanır (Kullanım sekmesinde bu ayki sayı görünür).

## Yapay zeka merkezi (`/admin/zeka`)

Kapı: `advisor` modülü (proxy-gates satırı `/admin/zeka`), menü satırı `src/lib/admin/nav.ts` "AI & entegrasyon" grubunda.
Yazma yalnız süper admin (`advisor:write` + rol; eylemlerde zorunlu); modülü gören diğer personel her sekmeyi salt okunur görür.
Her ayar yazımı registry üzerinden gider (`applyPlatformWrites`): doğrulama, `settings_history` sürümü ve platform denetim satırı.
Her sekmenin altında "Son değişiklikler" listesi vardır; önceki sürüme dönüş Ayar merkezinden yapılır.

| Sekme | İçerik |
|---|---|
| Bağlantı | Anahtar durumu (değer yok) ve gömülü anahtar formu, model, "Bağlantıyı test et" (süre + sonuç) |
| Yüzeyler | Ofis paneli, ana sayfa ve site, vitrin, yönetim: aç/kapa, kip (otomatik/yerel/GPT), kişi başına ve ofis başına günlük soru, jeton üst sınırı |
| Davranış | Kişilik ve ton, yüzeye özel istem ekleri, yasaklı konular, yanıt dili. Metinler sunucuda kalır, GPT sistem istemine ayrı blok olarak girer; güvenlik ve kapsam kuralları sonra ve öncelikli tekrar edilir. Yasaklı konu yerel motorda da uygulanır |
| Bilgi | Bilgi kaynakları aç/kapa, yüzey başına parça sayısı, vektör sayısı, son dizin kurulumu ve gece bakımı, "Yeniden oluştur", onaylı soru-cevaplar |
| Kullanım | Yüzey, motor, niyet ve ofis dağılımı (her sayı Kayıtlar'ı süzgeçle açar), ofis kredisinden düşen Zeka harcaması, platform kotası, en çok sorulan cevapsız sorular ve onaylı yanıt ekleme |
| Kayıtlar | Maskelenmiş sorgu günlüğü: metin, yüzey, motor, niyet, durum (yanıtlanan, yanıtlanamayan, düşük güven, beğenilen/beğenilmeyen, yasaklı konu), dönem, ofis; sayfalı |

## Güvenlik ve gizlilik

- OpenAI çağrıları yalnız `openai-client.ts` üzerinden gider. Telefon, TC, e-posta, IBAN ve kart bilgisi maskelenir. Uygulamada sorgudaki kişi adı da maskelenir; araç argümanları sunucuda geri çevrilir.
- Hız sınırları ve kapılar:
  - **Uygulama:** kullanıcı başına öneri için 90/dk, yanıt için 20/dk.
  - **Public:** IP başına öneri için 60/dk, yanıt için 20/10 dk. İstek aynı kökenden gelmeli ve tarayıcı kimliği taşımalı.
  - **Vitrin:** IP başına ve ofis başına ayrı sınır.
  - **Yönetim:** personel başına sınır.
  - Hız sınırı altyapısı yoksa istek reddedilir (`failurePolicy: "deny"`).
- Günlük sınırlar (yönetimden): kişi ve ofis başına 24 saatlik pencere; dolunca uç nokta 429 ve "Bugünkü soru sınırına ulaşıldı" döner.
- Girdi en çok 300 karakterdir; geçmiş en çok 3 soru, sayfa yalnız site içi yol (istemci girdisi `sanitizeHistory`/`sanitizePage` ile temizlenir).
- Yetki reddinde veri sorgusu hiç çalışmaz. Örnekler: danışman ofis cirosunu soramaz, çağrı merkezi portföy sayısını soramaz, ofisin kapattığı modül sorgulanmaz.
- Para tutarları tam TL yazılır (₺12.500.000); kısaltma kullanılmaz.

## Testler

- `src/lib/ai/zeka/zeka-nlu.test.ts`: normalleştirme, niyet ve yuva tablosu (66 gerçekçi Türkçe sorgu, her rolden).
- `src/lib/ai/zeka/zeka-engine.test.ts`: yetki kapsamı, ASLA YAZMAZ sözleşmesi, GPT hatasında yerel motora düşüş, GPT'nin aynı araçları kullanması.
- `src/lib/ai/zeka/zeka-surfaces.test.ts`: bilgi katmanı, BM25 ve melez arama, dizin farkı, public, vitrin ve yönetim yüzeyleri.
- `src/lib/ai/zeka/zeka-context.test.ts`: çok turlu yuva taşıma ("bunlardan kaçı kiralık?", "peki geçen ay?", "Beşiktaş'ta?"), takip olmayan soru, her turda yetki, vitrin, davranış politikası, başlangıç soruları.
- `src/components/zeka/zeka-fab-contract.test.ts`: yüzen düğmenin tembel yüklenmesi, Ctrl+J, erişilebilir ad, yerleşimler, tek sohbet uygulaması.
- `e2e/zeka.spec.ts`: yalnız `APP_URL` ile çalışır. "Ofis sahibi" demo kartıyla girer, komut çubuğuna 3 sorgu yazar; ayrıca /app/portfoyler, /admin ("Süper admin" kartı) ve public ana sayfada yüzen düğmeyi tıklar, başlangıç ve devam sorusunu yanıtlatır, Esc ve Ctrl+J'yi dener; 1366 ve 390 px'de yatay kaydırma olmadığını doğrular.
