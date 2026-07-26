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

## Değişmezler

Portal scrape yok · tam Türkçe UI · dark mode yok · sahte metrik yok (her sayı tıklanabilir) ·
`Date.now()` bileşende yasak → `src/lib/clock.ts` · multi-tenant izolasyon her katmanda.
