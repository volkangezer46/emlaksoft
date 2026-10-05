# EmlakSoft — Mimari Özet (1 sayfa)

Yeni katılan biri için sistemin haritası. Doğrulama kaynağı: `src/` + `supabase/migrations/` (2026-10-05). Güncel sayılar: `docs/DURUM.md`; proje kuralları: `CLAUDE.md` (çelişirse CLAUDE.md geçerlidir).

## Katmanlar (URL uzayı)

| Katman | Yol | Koruma |
|---|---|---|
| Landing + public | `/`, `/demo`, `/kayit`, `/giris`, KVKK/politika sayfaları, `robots`, `sitemap`, OG image | Açık |
| Tenant paneli | `/app/*` (menü 9 iş başlığı, tek kaynak `src/lib/nav-config.ts`; müşteriler, talepler, portföyler, anlaşmalar, komisyon/kazanç, kiralama, projeler, asistan, ekip, uyum, abonelik, ayarlar…) | Oturum + `requireModulePage` + ofis modül kapısı + paket kapısı |
| Ofis panosu (TV) | `/app/pano-tv` (kabuksuz, tam ekran, canlı) | Oturum + ofis geneli rol (`canViewTv`) |
| Platform admin | `/admin/*` (tenant, fatura, ticket, cron sağlık, SEO, impersonation) | `platform_staff` + `PLATFORM_ADMIN_EMAILS` bootstrap |
| Vitrin | `/vitrin/[slug]` — tenant'ın halka açık ofis sitesi | Açık, slug bazlı |
| Token sayfaları | `/paylas/[token]` (portföy paylaşım) · `/musteri-portali/[token]` · `/malik-portali/[token]` · `/imza/[token]` (SMS OTP e-imza) · `/odeme-link/[token]` (iyzico) · `/degerleme-raporu/[token]` · `/lead` | Tekil token, oturumsuz |
| API | `/api/cron/*` (35), `/api/app/*` (bootstrap, tv-data), `/api/export/[entity]`, `/api/property-media/[id]` | Bearer `CRON_SECRET` / oturum |

Veri erişimi: Server Component + server action ağırlıklı; mutasyonlar `src/app/actions/*` ve modül içi `actions.ts`.

## Veri modeli ana hatları (243 migration dosyası; TL hesap kredisi, referans/ortak motoru, kayıtlı kart ve EF kontör için `docs/HAFIZA.md` §2/§6)

- **Çekirdek:** `tenants` → `profiles` (rol) → `customers` (360: dosyalar, tarihler, lead sinyalleri, birleştirme) · `demands` (talep) · `properties` (+medya, fiyat geçmişi trigger'lı, lat/lng, aidat) · `portal_listings` (ilan no/URL teyidi — scrape yok).
- **İşlem hattı:** eşleştirme → `appointments` → `offers`/`offer_rounds` → `deals` (+masraf) → `commissions` → `contracts` (şablon + sürüm + OTP imza) → kayıp-kaçak (`leak-sla`).
- **Modüller:** kiralama (tahakkuk/kira), projeler, kampanyalar, görevler, hedefler, giderler, cüzdan, bölge analitiği (`region_stats_history`, emsal motoru), vitrin analitik.
- **Platform:** abonelik/fatura (iyzico), ticket, `platform_audit_logs`, `error_logs`, `cron_heartbeats`, `rate_limits`, KVKK yaşam döngüsü, çöp kutusu, 2FA (`two_factor`), `tenant_integrations` (tenant Netgsm vb.).
- **Geo:** `geo_*` il/ilçe/mahalle tabloları (seed migration + `geo:sync`).

## İzin sistemi (3 katman)

1. `src/lib/permissions.ts` — rol×modül×aksiyon varsayılan MATRIX'i (tip kaynağı `AppModule`/`AppAction`).
2. `permission_defaults` — MATRIX'in DB kopyası (RLS + referans, migration 014/016).
3. `user_permission_overrides` — kullanıcı bazlı istisna + geçici yetki (migration 067).

Etkin izin `permissions-effective.ts`'te birleşir; sunucu kapıları `requirePermission` (action) ve
`requireModulePage` (sayfa). Platform staff kendi ops oturumunda geçer, impersonation'da readonly.
SQL tarafı `current_tenant_id()` JWT claim'i ile RLS (migration 002, role-aware 016).

## Cron envanteri (35 — `vercel.json` + `src/app/api/cron/*`, sayı `npm run check:cron` ile doğrulanır)

Bildirim/özet: `gunluk-ozet` (07:00) · `haftalik-ozet` (pzt 07:30) · `randevu-hatirlat` (30 dk) · `gorev-hatirlat` (2 s) · `dogum-gunu` (08:00) · `vitrin-eslesme` (10:00 kayıtlı arama) · `vitrin-alarm` (10:30) · `anahtar-gecikme` (09:00) · `campaign-delivery` (2 dk).
İlan/kayıp-kaçak: `portal-teyit` (6 s ilan teyidi) · `leak-sla` (12 s kaçan komisyon).
Motorlar/veri: `otomasyon` (06/14) · `bolge-snapshot` (aylık) · `lig-snapshot` (aylık, önceki ay TR takvimi) · `tcmb-kur` (13:30 hafta içi) · `kira-tahakkuk` (05:00) · `proje-vade` (05:30) · `geo-sync` (3 aylık) · `geo-province-sync` (5 dk).
Platform/faturalama: `abonelik-kontrol` (gece yarısı) · `dunning` (09:00) · `billing-reconciliation` (10 dk) · `ticket-sla` (5 dk) · `ticket-attachment-cleanup` · `operational-retention` · `direct-file-upload-cleanup` · `public-mutation-outbox` (2 dk).
SEO: `seo-robot` (04:20, yalnız kendi alan adını tarar).
Kontör: `ef-kontor-hak` (günlük 04:10 TR; plan `efCreditsMonthly` aylık hibe + hoş geldin kontörü; `ef_credit_ready()` değilse atlar, past_due/askıda/modül kapalı ofis hak almaz).
Büyüme: `growth-claims` (günlük 06:40 TR; referans/ortak talep işleyicisi: kaçırılan talep, iade geri alma, vadesi gelen ödülü TL kredi olarak yükleme, kademe bonusu, clawback, ortak komisyon onayı; `try_credit_ready()` değilse ödül yüklemez, service_role istemcisi `runBillingReconciliation(0, "growth_claims")` (kapalı iş seçici, rastgele callback yok) üzerinden gelir).
Kontör süpürme: `ef-kontor-sweep` (10 dakikada bir; 15 dakikadan eski açık EF rezervlerini `ef_credit_sweep()` ile serbest bırakır; service_role istemcisi `runBillingReconciliation(0, "ef_sweep")` üzerinden gelir).
Kontör sağlık: `ef-kontor-saglik` (günlük 01:50 UTC = 04:50 TR; ortak istemci probe'u `GET /kullanim`: başarıda `emlakfiyati_ortak_probe_ok_at` yenilenir, başarısızlıkta silinir; anahtar/bayrak yoksa atlar; EmlakFiyati "live" durumu 7 günden eski damgada düşer, tek kaynak `src/lib/ef-credits/public-state.ts`).
Kontör mutabakat: `ef-kontor-mutabakat` (günlük 02:10 UTC = 05:10 TR; EF `GET /kullanim` son 31 gün `toplam.degerleme/pdf` ile defter `ef_credit_reservations` state=committed sayımı karşılaştırılır, tolerans 2; sonuç `ef_reconciliation_runs`; sapmada platform bildirimi; anahtar/bayrak yoksa atlar; saf mantık `src/lib/ef-credits/reconcile.ts`).
Hepsi `CRON_SECRET` Bearer + `recordHeartbeat` (admin cron sağlık panosu). Modül sistemi açıkken kapalı modülün işini yapan cron'lar o ofisi atlar (6 cron).

## Yetki, paket, modül: üç ayrı kapı

Yetki = kim ne yapabilir (rol matrisi, yukarıdaki 3 katman). Paket = ne satın alındı (`src/lib/billing/page-gates.ts` sayfa bazlı kilit, `plans.ts` varsayılan, `plan-definitions.ts` **plan okuyucu**: `getPlanDefinitions`, `getPublicPlanDefinitions`, `quotePlan`, `getFoundersStatus`; panel düzenlemesi `plan-overrides.ts`, yazma sonrası `updateTag(PLAN_DEFINITIONS_TAG)`, hata olursa `plans.ts` varsayılanı).
Modül = ofiste açık mı (`src/lib/modules/*`): `registry.ts` ürün modülü anahtarları (rota önekleri, bağımlılıklar, kapanınca neyin durduğu), `logic.ts` saf durum (SATIR YOKSA AÇIK, çekirdek kapatılamaz), `guard.ts` sayfa/action kapısı (`actionBlockedByModule`), `pending.ts` kapatırken bekleyen iş uyarısı, ekran `/app/ayarlar/moduller`. Kapalı modülün token'lı public yolları "kapalı" sayfası gösterir; ilgili cron'lar o ofisi atlar.
Not: `FeatureKey` (ürün alanı) ile `AppModule` (izin modülü) aynı şey değildir; yeni izin modülü için CLAUDE.md'deki 4 kayıt yeri geçerlidir.

## Platform bayrakları, TV, telefon

- **Bakım modu:** `src/lib/platform-flags.ts` + `platform-flags-cache.ts` (30 sn bellek önbellek); `src/proxy.ts` public sayfalarda okur. Okunamazsa güvenli varsayılan: bakım KAPALI, kayıt AÇIK, deneme 14 gün.
- **TV modu (`/app/pano-tv`):** veri `src/lib/tv/tv-data.ts` (oturumlu client + RLS; service_role YOK), mantık `tv-logic.ts`, istemci `/api/app/tv-data` ile canlı çeker. Müşteri telefon/e-posta/adres hiç seçilmez; gelir ve ofis komisyonu yalnız `earnings_all` ile. Rakamlar ana ekran/ekip metrikleriyle AYNI tek kaynaktan (`loadAdvisorMetrics`) ve aynı örnek-veri kapsamıyla gelir. Sözleşme: `tv-privacy-contract.test.ts`.
- **Telefon tek merkez:** `src/lib/phone-rules.ts` (libphonenumber-js/min) + `PhoneInput`; saklama TR `05XXXXXXXXX`, yabancı `+<E.164>`; sunucuda `parsePhoneStrict`/`phoneSchema`. Ayrıntı ve kontrol listesi `CLAUDE.md`, sözleşme `contact-input-contract.test.ts`.

## Terim, rol etiketi ve zaman: tek kaynak

- **Terim sözlüğü:** `src/lib/terminology.ts` (kanonik ad + yasaklı varyant; `terminology-contract.test.ts` kullanıcıya görünen metinde "lead", "cüzdan", "kişisel hakediş" yakalar). Yol adları (`/app/ayarlar/lead`, `/lead/[token]`) değişmez, yalnız metin.
- **"Kayıp" üç ayrı kavram:** (1) **Kaçan komisyon** = portal teyidiyle kaçan ilanın tahmini para kaybı (kayıp-kaçak kalkanı, `/app/kayip-kacak`, ana ekran "Kaçan komisyonlar" kartı); (2) **Kaybedilen anlaşma / kayıp nedeni** = anlaşma kapanışında seçilen sebep (anlaşma kapanış diyaloğu, `lib/loss-reason.ts`, raporlar "Kaybedilen anlaşmalar" kartı); (3) **Risk altındaki müşteriler** = ilgilenilmeyen müşteri/talep (`/app/kayip-satis`). Yeni ekranda "kayıp" kelimesi yalnız bu üç adın biriyle kullanılır.
- **Rol etiketi:** `src/lib/role-labels.ts` (`ROLE_LABELS`, `roleLabel()`); yerel kopya yazma (`role-labels-contract.test.ts`).
- **Zaman:** sunucu UTC'de çalışır, iş günü/ayı Türkiye takvimidir (UTC+3, DST yok). Gün/ay sınırı `src/lib/clock.ts` yardımcılarıyla kurulur: `trDayStartIso`, `trMonthStartIso`, `trMonthKey`, `shiftMonthKey`. `Date.UTC(...)`, `setDate(1)`, `getUTCMonth()` ile ay sınırı kurma; ayın ilk 3 saati önceki aya yazılır.

## AI katmanı (API + insan onayı; kendi model yok)

`src/lib/ai/` — `briefing-summary` (günaydın brifingi), `content` (ilan/pazarlama metni), `document-ocr` (vision OCR), `streaming` · `src/lib/ai-advisor.ts` (tenant asistanı `/app/asistan`, doğal dil arama) · `advisor-coach` (Next Best Action). Model: OpenAI `gpt-4o-mini` varsayılan (`OPENAI_MODEL`/`OPENAI_VISION_MODEL` ile değişir); anahtar yoksa özellikler "bağlantı bekliyor" durumuna düşer.

## Realtime + PWA

- **Realtime:** `src/hooks/use-realtime-refresh.ts` + bildirim zili + destek sohbeti 6 tabloyu dinler (`notifications, deals, commissions, portal_listings, customers, support_ticket_messages`); publication migration 078'de idempotent tanımlı. Kanal filtreleri tenant_id ile sınırlı.
- **PWA:** `public/manifest.webmanifest` + `public/sw.js` (offline: `offline.html`), kayıt `sw-register.tsx`; web push `web-push` + VAPID (`push-subscribe.tsx`, `src/lib/push.ts`, `push_subscriptions` tablosu).

## SEO sistemi (`/admin/seo`, `src/lib/seo/*`)

Tek kaynak `src/lib/seo/`: `registry.ts` (yönetilebilir statik sayfa envanteri + varsayılan başlık/açıklama/OG; ayar yokken bugünkü değerler birebir),
`schema.ts` (zod şemaları, boyut sınırları, güvenli varsayılanlar), `metadata.ts` (saf çözümleyici), `store.ts` (`getSeoSettings` önbellekli, `buildMetadata`),
`sitemap-rules.ts`/`sitemap-data.ts`, `robots-rules.ts`, `jsonld.ts` (üretim + doğrulayıcı), `redirects.ts`, `audit-rules.ts` + `audit-runner.ts` + `robot.ts` (günlük robot, IndexNow).
Ayarlar `platform_settings` anahtarlarındadır: `seo.global`, `seo.pages`, `seo.sitemap`, `seo.robots`, `seo.redirects`, `seo.indexnow`(+`.seen`), `seo.audit.latest`, `seo.audit.history`.
404 sayaçları için tek yeni tablo: `seo_404_hits` (migration `20260816001790`; yoksa özellik gizlenir, diğer her şey çalışır).
Yetki: platform modülü `seo` — süper admin (hepsi) ve operasyon (sayfa içeriği, yönlendirme, salt okunur robot/404); robots, sitemap kapsamı, genel ayarlar, IndexNow, "şimdi çalıştır", içe aktarma yalnız süper admin.

**Yeni public sayfa eklerken kontrol listesi**
1. Sayfa `generateMetadata` içinde `buildMetadata("/yol")` kullanır (elle `metadata` sabiti yazma). Yeni statik sayfayı `registry.ts`'e ekle (başlık, açıklama, OG, sitemap kuralı, JSON-LD türleri). Dinamik sayfa `buildMetadata(path, { title, description, ... })` ile `extra` verir.
2. Sitemap: indekslenebilir her sayfa registry'deki `sitemap.include` ile girer; dinamik kayıtlar `sitemap-data.ts`'e eklenir ve `filterSafeEntries` süzgecinden geçer. Token'lı/kişiye özel/oturumlu/ödeme/imza/anket/randevu/sunum yüzeyleri ASLA girmez (`NEVER_INDEX_PREFIXES`); yeni bir token yüzeyi eklersen önek listelerine (`registry.ts`) ve `seo-contract.test.ts` listesine ekle.
3. noindex gerekçesi: kişiye özel (token), giriş/şifre/MFA, deneme/demo (örnek) veriler. Token sayfaları `robots: { index: false, follow: false }` taşır ve robots.txt'te kapalıdır; sözleşme testi bunu denetler.
4. JSON-LD: `SeoJsonLd` bileşeni; FAQPage yalnız görünen SSS ile; AggregateRating/Review ASLA; fiyat KDV hariç ve gerçek (plans.ts).
5. Eski yol değişirse `/admin/seo` > Yönlendirmeler'den 308 kuralı ekle (çözücü yalnız 404'e düşen yollarda çalışır: `src/app/[...slug]/page.tsx`).
6. Robot (`seo-robot` cron, günlük 04:20) yalnız kendi alan adını tarar; sonuç `/admin/seo` Robot sekmesindedir. IndexNow varsayılan KAPALI ve yalnız süper admin açar.

## Değişmezler

Portal scrape yok · tam Türkçe UI · koyu tema yalnız /app ve /admin (vitrin/portallar hep açık) · sahte metrik yok (her sayı tıklanabilir) ·
`Date.now()` bileşende yasak → `src/lib/clock.ts` · multi-tenant izolasyon her katmanda.
Para/tarih biçimi tek kaynak: `src/lib/format.ts` (TR saat dilimi, hidrasyon güvenli); ortak durum etiketleri `src/lib/status-labels.ts`.

## Demo veri kuralları

Tek merkez: `src/lib/sample-scope.ts`. `is_sample=true` kayıtlar (örnek veri) için:
1. **Public görünürlük yok:** vitrin liste/detay, OG görselleri, sitemap, sunum, paylaş, danışman kartı, malik/müşteri portalı, randevu teyit/alma, tavsiye, favoriler, açık ev, değerleme raporu: her `properties` sorgusu `.eq("is_sample", false)` / `publicPropertyFilter` / `notSample` taşır; demo kayda doğrudan URL 404 verir. `src/lib/sample-scope.test.ts` kaynak taramasıyla zorlar; yeni public yüzey `PUBLIC_FILES` listesine eklenir.
2. **Dış gönderim yok:** otomasyon SMS (`automation-engine.ts`) ve kampanya teslimi (`campaign-delivery.ts`) demo alıcıyı `demo_blocked` ile atlar; yeni dış gönderim yolu `isSampleRecipient`/`isSampleCustomer` kapısı taşımalıdır. İç bildirimler (ekibe zil) serbesttir.
3. **KPI eşiği (tek yardımcı):** lig/KPI/rapor/TV demo kayıtları YALNIZ ofiste gerçek (is_sample=false) müşteri ve portföy sayısı `SAMPLE_KPI_THRESHOLD` (5) altındaysa içerir. Karar noktası `loadSampleKpiScope(client, tenantId)` → `SampleKpiScope` (`include`, `values`, `apply(query)`, `label`); eşik altında rakamlar örnek kayıtları içerir ve ekranda **"Örnek veri dahil"** etiketi (`SampleDataBadge`) görünür, eşik aşılınca `is_sample=false` otomatik uygulanır. KPI sorgusunu kopyalayıp eşiği yeniden yazma: yeni KPI sorgusu `scope.apply(...)` veya `scope.values` kullanır. Uygulanan yüzeyler: lig (`gamification-query.ts`), ana ekran (`app/_home/data.ts`, `ctx.sample`), danışman metrikleri (`team/advisor-metrics.ts`: danışman KPI, kıyas, Performansım, hedefler, Danışman 360), pano-tv (`tv/tv-data.ts`), ofis skoru (`office-score.ts`), raporlar (yalnız etiket). `fetchCommissionRows` yalnız `sample` verilirse süzer (cüzdan/hakediş gerçek kayıttır, süzülmez). Sınır: `tenant_reporting_aggregates` ve `tenant_commission_aggregates` RPC'leri `is_sample` bilmez; süzgeç için migration gerekir. Sözleşme: `src/lib/sample-kpi-scope.test.ts`.
