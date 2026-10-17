# EmlakSoft Zeka

Zeka, sistemin her yüzeyinde çalışan yerleşik yapay zekadır. Tek bir çekirdek vardır, dört yüzeye hizmet verir. Bugün **harici API olmadan** çalışır ("yerel zeka"). OpenAI anahtarı eklenince **kod değişmeden** GPT ile çalışır. Bu durumda da veriyi aynı yetkili araçlarla okur.

## Yüzeyler ve veri sınırları

| Yüzey | Giriş | Uç nokta | Veri sınırı | GPT ölçümü |
|---|---|---|---|---|
| Ofis paneli (`app`) | Ana ekrandaki "Ne yapmak istiyorsun?" kutusu, komut paletindeki (Ctrl K) "Zeka'ya sor" satırı | `POST /api/zeka` | Oturum ve RLS. Ek olarak etkin izin, kapalı modül, liste kapsamı (kendi/takım/şube) ve `earnings_all` | Ofis AI kredisi (`canAutoCallAi` kapısı) |
| Platform sitesi (`public`) | Ana sayfa kahramanındaki küçük kutu; ana sayfa, araçlar, rehber ve fiyatlar sayfalarında yüzen "EmlakSoft'a sor" düğmesi | `POST /api/zeka/genel` | Yalnız herkese açık içerik: paket ve fiyat, site sayfaları, SSS, rehber, sözlük, onaylı soru-cevap | Platform AI kotası (`zeka.public`) |
| Vitrin (`vitrin`) | Vitrinde yüzen "İlan asistanı" | `POST /api/zeka/vitrin` | Yalnız o ofisin yayındaki ilanları (`vitrin_listing_search`) | Ofis AI kredisi. Ayrıca ofisin "vitrin sohbet asistanı" ayarı açık olmalı (varsayılan kapalı) |
| Yönetim (`admin`) | Yönetim ana ekranındaki komut çubuğu, palet satırı "Zeka'ya sor ve eğit" (`/admin/zeka`) | `POST /api/zeka/yonetim` | Salt okunur platform özeti (`buildAdvisorContext`, yalnız `advisor` modülüne). Personelin görebildiği menü | Platform AI kotası (`zeka.admin`) |

**Zeka hiçbir iş kaydı yazmaz.** "Oluştur" isteği yalnız ön doldurulmuş bir form bağlantısı üretir (örnek: `/app/randevular/yeni?customer=…&tarih=…&saat=…`). Kayıt, kullanıcı formu açıp kaydettiğinde mevcut kapılı action ile oluşur. Vitrinde talep, ziyaretçi mevcut talep formunu kendisi gönderdiğinde oluşur. Bu kural `zeka-engine.test.ts` içindeki "ASLA YAZMAZ" sözleşmesiyle kilitlidir. Zeka'nın yazdığı tek veri, kişisel verisi maskelenmiş sorgu günlüğüdür.

## Mimari

```
src/lib/ai/zeka/
  types.ts           ZekaResult, ZekaCard, ZekaAction, ZekaEngine arayüzü
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
src/components/zeka/ zeka-panel.tsx (tembel yanıt paneli), public-ask.tsx (public ve vitrin girişi), public-launcher.tsx
src/app/api/zeka/    route.ts (app), genel/, vitrin/, yonetim/, geri-bildirim/
src/app/admin/zeka/  Zeka eğitimi ekranı
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
- Onaylı soru-cevaplar (`zeka_qa`): yönetici "Zeka eğitimi" ekranında ekler.

Parçalar sürümlüdür (`knowledgeVersion`, içerik özeti). Arama yöntemi kuruluma bağlıdır:

- **Anahtarsız kurulum:** BM25 sözcüksel arama, Türkçe kök desteğiyle.
- **Anahtarlı kurulum:** gömme vektörü (kosinüs) ile BM25 birlikte kullanılır (`hybridScores`).

Yetki süzgeci aramadan önce uygulanır. Kullanıcının göremediği modülün parçası hiçbir motorun bağlamına girmez.

### Öğrenme döngüsü

1. Her yanıt `zeka_query_log` tablosuna yazılır: maskelenmiş metin (en çok 300 karakter), niyet, motor, güven, yanıtlandı mı, düşüş nedeni.
2. Panelde "Yanıt işinize yaradı mı?" sorusu olumlu/olumsuz oy toplar (`/api/zeka/geri-bildirim`; satır başına bir kez, 24 saat içinde).
3. `/admin/zeka` ekranı şunları gösterir: son 30 günün sayaçları (niyete, motora ve yüzeye göre) ve cevapsız, düşük güvenli ya da beğenilmeyen sorgular. Yönetici bu sorgulara onaylı yanıt ekler.
4. Onaylı yanıtlar iki motorun da bilgi tabanına girer (süreç içi önbellek boşaltılır).
5. Gece bakımı (`/api/cron/olcum-bakim`, ikinci adım `runZekaIndex`) anahtar varsa yalnız içeriği değişen parçaları yeniden gömer. Silinen parçalar dizinden çıkar.

## Kurulum: OpenAI anahtarını eklemek (kod değişikliği yok)

1. **Yönetim > Sistem > Entegrasyonlar > OpenAI API anahtarı** alanına `sk-…` anahtarını girip kaydedin. Anahtar şifreli saklanır (`ai.openai_api_key`) ve hiçbir yerde gösterilmez. Ortam değişkeni `OPENAI_API_KEY` yedektir.
2. Kip varsayılan olarak **otomatik**tir. Anahtar tanımlı olduğu an her yüzey GPT ile yanıtlar. Anahtar yoksa, GPT hata verirse ya da kota dolarsa yanıtı yerel zeka verir; panelde "Yerel zeka" rozeti görünür.
3. Bir sonraki gece bakımında bilgi tabanının gömme dizini kurulur. Hemen kurmak için `/api/cron/olcum-bakim` işini `CRON_SECRET` ile elle tetikleyin. Bundan sonra arama melez çalışır.
4. Öğrenme tabloları için `supabase/migrations/20261024010000_zeka_learning.sql` uygulanmış olmalıdır (pencere ZK1). Bu dosya yokken de Zeka çalışır, yalnız günlük, soru-cevap ve dizin katmanları atlanır.
5. İsteğe bağlı platform kotası: `platform_settings` içinde `zeka.public`, `zeka.admin` ve `zeka.index` anahtarlarına `{"monthlyLimit": N}` yazılırsa ilgili platform çağrıları aylık N ile sınırlanır.

## Yönetici ayarları (registry, "AI ve kota" kategorisi)

| Anahtar | Varsayılan | Anlamı |
|---|---|---|
| `zeka.enabled.app`, `zeka.enabled.public`, `zeka.enabled.vitrin`, `zeka.enabled.admin` | açık | Yüzeyi aç/kapat. Kapalı yüzeyin girişi gizlenir ve uç noktası yanıt vermez |
| `zeka.mode.app`, `zeka.mode.public`, `zeka.mode.vitrin`, `zeka.mode.admin` | `auto` | `auto`: anahtar varsa GPT, yoksa yerel. `local`: yalnız yerel. `gpt`: GPT; hata, anahtar yokluğu ya da kotada yerel |
| `zeka.model` | boş (`OPENAI_MODEL`, yoksa gpt-4o-mini) | GPT modeli |
| `zeka.max_tokens` | 600 | Yanıt üst sınırı (100–2000) |
| `zeka.embeddings_enabled` | açık | Anlamsal dizin |
| `zeka.embedding_model` | `text-embedding-3-small` | Gömme modeli. Değişirse dizin yeniden kurulur |

## Güvenlik ve gizlilik

- OpenAI çağrıları yalnız `openai-client.ts` üzerinden gider. Telefon, TC, e-posta, IBAN ve kart bilgisi maskelenir. Uygulamada sorgudaki kişi adı da maskelenir; araç argümanları sunucuda geri çevrilir.
- Hız sınırları ve kapılar:
  - **Uygulama:** kullanıcı başına öneri için 90/dk, yanıt için 20/dk.
  - **Public:** IP başına öneri için 60/dk, yanıt için 20/10 dk. İstek aynı kökenden gelmeli ve tarayıcı kimliği taşımalı.
  - **Vitrin:** IP başına ve ofis başına ayrı sınır.
  - **Yönetim:** personel başına sınır.
  - Hız sınırı altyapısı yoksa istek reddedilir (`failurePolicy: "deny"`).
- Girdi en çok 300 karakterdir.
- Yetki reddinde veri sorgusu hiç çalışmaz. Örnekler: danışman ofis cirosunu soramaz, çağrı merkezi portföy sayısını soramaz, ofisin kapattığı modül sorgulanmaz.
- Para tutarları tam TL yazılır (₺12.500.000); kısaltma kullanılmaz.

## Testler

- `src/lib/ai/zeka/zeka-nlu.test.ts`: normalleştirme, niyet ve yuva tablosu (66 gerçekçi Türkçe sorgu, her rolden).
- `src/lib/ai/zeka/zeka-engine.test.ts`: yetki kapsamı, ASLA YAZMAZ sözleşmesi, GPT hatasında yerel motora düşüş, GPT'nin aynı araçları kullanması.
- `src/lib/ai/zeka/zeka-surfaces.test.ts`: bilgi katmanı, BM25 ve melez arama, dizin farkı, public, vitrin ve yönetim yüzeyleri.
- `e2e/zeka.spec.ts`: yalnız `APP_URL` ile çalışır. "Ofis sahibi" demo kartıyla girer, 3 sorgu yazar, 1366 ve 390 px'de panelin açıldığını ve yatay kaydırma olmadığını doğrular.
