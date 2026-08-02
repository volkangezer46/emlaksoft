# ARCHITECTURE.md — EmlakSoft

> Sistemin haritası, yeni katılan bir AI/insan için. Sayılar (migration/cron/rota adedi)
> hızla eskir — kesin sayı gerekiyorsa `ls supabase/migrations/ | wc -l`,
> `cat vercel.json` (crons dizisi) gibi komutlarla anlık doğrula. Daha eski/detaylı
> bir kopya `docs/MIMARI.md`'de bulunur; bu dosya onun kök dizindeki güncel halidir.

## Katmanlar (URL uzayı)

| Katman | Yol | Koruma |
|---|---|---|
| Landing + public | `/`, `/demo`, `/kayit`, `/giris`, KVKK/politika sayfaları, `robots`, `sitemap`, OG image | Açık |
| Tenant paneli | `/app/*` (~40 modül: müşteriler, talepler, portföyler, anlaşmalar, komisyon, kiralama, projeler, destek, asistan, ayarlar…) | Oturum + `requireModulePage` |
| Platform admin | `/admin/*` (tenant, fatura, ticket/destek kuyruğu, cron sağlık, impersonation) | `platform_staff` + `PLATFORM_ADMIN_EMAILS` bootstrap |
| Vitrin | `/vitrin/[slug]` — tenant'ın halka açık ofis sitesi | Açık, slug bazlı |
| Token sayfaları | `/paylas/[token]` (portföy paylaşım) · `/musteri-portali/[token]` · `/malik-portali/[token]` · `/imza/[token]` (SMS OTP e-imza) · `/odeme-link/[token]` (iyzico) · `/degerleme-raporu/[token]` · `/lead/[token]` · `/randevu-al/[token]`, `/randevu-teyit/[token]` · `/acik-ev-kayit/[token]` · `/anket/[token]` · `/sunum/[token]` · `/tavsiye/[token]` | Tekil token, oturumsuz, hız-sınırlı (bkz. `src/lib/public-request-security.ts`) |
| API | `/api/cron/*`, `/api/webhooks/*` (Netgsm SMS, iyzico, Meta), `/api/ticket-attachments/*`, `/api/app/*`, `/api/property-media/[id]` | Bearer `CRON_SECRET` / imza doğrulama / oturum |

Veri erişimi: Server Component + server action ağırlıklı; mutasyonlar `src/app/actions/*`
ve modül içi `actions.ts` dosyalarında. Admin client (`createAdminClient()`, service_role)
yalnızca server'da ve RLS'i bypass eder — her sorguda tenant_id elle filtrelenmeli.

## Veri modeli ana hatları

- **Çekirdek:** `tenants` → `profiles` (rol) → `customers` (360: dosyalar, tarihler, lead
  sinyalleri, birleştirme) · `customer_demands` (talep) · `properties` (+medya, fiyat
  geçmişi trigger'lı, lat/lng, aidat) · `portal_listings` (ilan no/URL teyidi — scrape yok).
- **İşlem hattı:** eşleştirme → `appointments` → `offers`/`offer_rounds` → `deals`
  (+masraf) → `commissions` → `contracts` (şablon + sürüm + OTP imza) → kayıp-kaçak
  (`leak-sla`).
- **Modüller:** kiralama (tahakkuk/kira), projeler, kampanyalar, görevler, hedefler,
  giderler, cüzdan, bölge analitiği (`region_stats_history`, emsal motoru), vitrin
  analitik, raporlama (`src/lib/reporting/` + `tenant_reporting_aggregates` /
  `tenant_commission_aggregates` / `platform_reporting_aggregates` RPC'leri — tam kapsamlı
  SQL aggregate, sayfalama/limitten bağımsız).
- **Destek/ticket sistemi:** `support_tickets` (+ SLA hedef tarihleri, `ticket_no`,
  `version`, `reopen_count`, `resolution_code/summary`) · `support_ticket_events`
  (audit-trail) · `support_ticket_attachments` (+ upload/scan zinciri) ·
  `support_ticket_csat` (müşteri memnuniyeti) · geçiş kuralları `src/lib/support/`
  (`isTicketTransitionAllowed`) hem TS hem SQL tarafında (`support_transition_allowed()`)
  aynalı tutulur.
- **Platform:** abonelik/fatura (iyzico, atomik fulfillment), ticket, `platform_audit_logs`,
  `error_logs`, `cron_heartbeats`, `rate_limits`, KVKK yaşam döngüsü, çöp kutusu, 2FA
  (`two_factor_verified_sessions`), `tenant_integrations` + `tenant_integration_secrets`
  (tenant Netgsm/WhatsApp/portal anahtarları — ayrı, sınırlı-erişimli tablo).
- **Geo:** `geo_*` il/ilçe/mahalle tabloları (seed migration + `geo:sync`).

## İzin sistemi (3 katman)

1. `src/lib/permissions.ts` — rol×modül×aksiyon varsayılan MATRIX'i (tip kaynağı
   `AppModule`/`AppAction`).
2. `permission_defaults` — MATRIX'in DB kopyası (RLS + referans).
3. `user_permission_overrides` — kullanıcı bazlı istisna + geçici yetki.

Etkin izin `permissions-effective.ts`'te birleşir; sunucu kapıları `requirePermission`
(action) ve `requireModulePage` (sayfa). Platform staff kendi ops oturumunda geçer,
impersonation'da readonly. SQL tarafı `current_active_tenant_id()` + `has_effective_permission()`
SECURITY DEFINER yardımcılarıyla RLS politikalarına bağlanır — TS ve SQL tarafı
hücre-hücre aynı kurala sahip olacak şekilde tutulmalı (contract testleri bunu doğrular,
bkz. `src/lib/*-contract.test.ts`).

## Cron envanteri

`vercel.json`'daki `crons` dizisine bakın (kesin liste ve zamanlama orada). Bilinen
kalıcı örnekler: `gunluk-ozet`, `randevu-hatirlat`, `gorev-hatirlat`, `portal-teyit`,
`abonelik-kontrol`, `leak-sla`, `dogum-gunu`, `tcmb-kur`, `otomasyon`, `bolge-snapshot`,
`vitrin-eslesme`, `dunning`, `kira-tahakkuk`, `ticket-sla`, `ticket-attachment-cleanup`,
`operational-retention`. Hepsi `CRON_SECRET` Bearer doğrular ve `recordHeartbeat` yazar
(admin cron sağlık panosunda görünür).

## AI katmanı (API + insan onayı; kendi model yok)

`src/lib/ai/` — `briefing-summary` (günaydın brifingi), `content` (ilan/pazarlama metni),
`document-ocr` (vision OCR), `streaming` · `src/lib/ai-advisor.ts` /
`src/app/actions/ai-tenant-advisor.ts` (tenant asistanı `/app/asistan`, doğal dil arama) ·
`advisor-coach` (Next Best Action). Model: OpenAI (env `OPENAI_MODEL`/`OPENAI_VISION_MODEL`
ile değişir); anahtar yoksa özellikler "bağlantı bekliyor" durumuna düşer.

## Mesajlaşma / webhook katmanı

- **Netgsm SMS (gelen):** `src/app/api/webhooks/netgsm-sms/route.ts` →
  `src/lib/webhooks/netgsm-contract.ts` (parse/fingerprint) +
  `src/lib/webhooks/netgsm-inbound.ts` (idempotent ingest, `webhook_events` tablosunda
  claim-then-process). Tenant eşlemesi yalnızca `subscriberNumber` →
  `tenant_integrations.external_account_id` üzerinden (müşteri telefonundan ASLA).
- **iyzico (ödeme):** `src/app/api/iyzico/{callback,webhook}/route.ts` — resmi
  X-IYZ-SIGNATURE-V3 şeması (alan-bazlı HMAC, ham-body değil); atomik fulfillment
  RPC'si (`fulfill_billing_payment`) conversationId ile kendi idempotency'sini sağlar.
- **Meta (WhatsApp/Messenger):** `src/app/api/webhooks/meta/route.ts` — imza doğrulama
  (HMAC-SHA256, ham body, timing-safe) çalışır durumda; **gelen mesajın işlenmesi
  (`communications` tablosuna yazılması) henüz STUB** — WhatsApp Business hesabı
  bağlanınca tamamlanacak (dosya içinde `STUB:` yorumuyla işaretli).
- Paylaşılan güvenlik yardımcıları: `src/lib/public-request-security.ts` (gövde-boyutu
  sınırı, CORS allowlist, opak rate-limit anahtarları, evidence hash) ve
  `src/lib/rate-limit.ts` (`failurePolicy: "allow"|"deny"` — güvenlik-kritik uçlar `deny`).

## Realtime + PWA

- **Realtime:** `src/hooks/use-realtime-refresh.ts` + bildirim zili + destek sohbeti;
  birkaç tabloyu dinler (`notifications, deals, commissions, portal_listings, customers,
  support_ticket_messages`), kanal filtreleri tenant_id ile sınırlı.
- **PWA:** `public/manifest.webmanifest` + `public/sw.js` (offline: `offline.html`),
  kayıt `sw-register.tsx`; web push `web-push` + VAPID (`push-subscribe.tsx`,
  `src/lib/push.ts`, `push_subscriptions` tablosu).

## Değişmezler

Portal scrape yok · tam Türkçe UI · dark mode yok · sahte metrik yok (her sayı
tıklanabilir) · `Date.now()` bileşende yasak → `src/lib/clock.ts` · zaman dilimi
hesapları `Europe/Istanbul`'a göre yapılır (sunucu/DB varsayılanı UTC olabilir) ·
multi-tenant izolasyon her katmanda (RLS + server-side tenant_id filtresi + contract
testleri).
