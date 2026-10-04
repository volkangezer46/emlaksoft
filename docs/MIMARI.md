# EmlakSoft — Mimari Özet (1 sayfa)

Yeni katılan biri için sistemin haritası. Doğrulama kaynağı: `src/` + `supabase/migrations/` (2026-07-26).

## Katmanlar (URL uzayı)

| Katman | Yol | Koruma |
|---|---|---|
| Landing + public | `/`, `/demo`, `/kayit`, `/giris`, KVKK/politika sayfaları, `robots`, `sitemap`, OG image | Açık |
| Tenant paneli | `/app/*` (~40 modül: müşteriler, talepler, portföyler, anlaşmalar, komisyon, kiralama, projeler, asistan, ayarlar…) | Oturum + `requireModulePage` |
| Platform admin | `/admin/*` (tenant, fatura, ticket, cron sağlık, impersonation) | `platform_staff` + `PLATFORM_ADMIN_EMAILS` bootstrap |
| Vitrin | `/vitrin/[slug]` — tenant'ın halka açık ofis sitesi | Açık, slug bazlı |
| Token sayfaları | `/paylas/[token]` (portföy paylaşım) · `/musteri-portali/[token]` · `/malik-portali/[token]` · `/imza/[token]` (SMS OTP e-imza) · `/odeme-link/[token]` (iyzico) · `/degerleme-raporu/[token]` · `/lead` | Tekil token, oturumsuz |
| API | `/api/cron/*` (13), `/api/app/*`, `/api/property-media/[id]` | Bearer `CRON_SECRET` / oturum |

Veri erişimi: Server Component + server action ağırlıklı; mutasyonlar `src/app/actions/*` ve modül içi `actions.ts`.

## Veri modeli ana hatları (79 migration)

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

## Cron envanteri (13 — `vercel.json` + `src/app/api/cron/*`)

`gunluk-ozet` (07:00 ofis özeti) · `randevu-hatirlat` (30dk) · `gorev-hatirlat` (2s) · `portal-teyit` (6s ilan teyidi) · `abonelik-kontrol` (gece yarısı) · `leak-sla` (12s kayıp-kaçak) · `dogum-gunu` (08:00) · `tcmb-kur` (13:30 hafta içi) · `otomasyon` (06/14 motor tetikleyici) · `bolge-snapshot` (aylık) · `vitrin-eslesme` (10:00 kayıtlı arama) · `dunning` (09:00 ödeme takibi) · `kira-tahakkuk` (05:00). Hepsi `CRON_SECRET` Bearer + `recordHeartbeat` (admin cron sağlık panosu).

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
