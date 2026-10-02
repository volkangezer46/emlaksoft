# EmlakSoft — Güncel Durum

**Tarih:** 2026-10-02 · **Dal:** main (HEAD a195713 anındaki kod). Yol haritası: `docs/ROADMAP.md`.
Bu sayılar bu tarihte dosya sisteminden/`package.json`'dan sayılmıştır; eskirler, gerektiğinde komutla yeniden sayın.

## Sürümler (package.json)

| Bileşen | Değer |
|---|---|
| Next.js | 16.3.8 (`eslint-config-next` 16.3.8) |
| React / React DOM | 19.2.4 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 (`@tailwindcss/postcss`) |
| Supabase | `@supabase/supabase-js` ^2.110.8, `@supabase/ssr` ^0.12.3 |
| Test | vitest ^4.1.10, @playwright/test ^1.62.0 |
| Node / npm | engines: node >=22, npm >=11.6.2 (`packageManager` npm@11.6.2); `.nvmrc` = 24 |
| Uygulama sürümü | 0.1.0 |

## Envanter (sayım)

| Konu | Sayı | Nasıl sayıldı |
|---|---|---|
| Migration dosyası | 177 | `supabase/migrations/*.sql`; son: `20260813000100_rls_initplan_policy_wrapping.sql` |
| Canlıda uygulanmış migration | 176 (kullanıcı bildirimi — **doğrulanmadı**) | Kesin sonuç için `npm run check:migrations -- --database` |
| `route.ts` dosyası | 51 | `src/app/**/route.ts` |
| Cron route / `vercel.json` zamanlaması | 27 / 27 | `src/app/api/cron/*`, `vercel.json` |
| `page.tsx` | 142 (hepsi `src/app` altında) | `src/app/**/page.tsx` |
| Test dosyası | 154 | `*.test.ts(x)` (src, e2e, scripts) |
| Test (case) sayısı | **doğrulanmadı** | `npm run test` çıktısından alınmalı |

Not: eski belgelerdeki "113 rota, 170 birim + 28 E2E test, 15 cron" gibi sayılar tarihseldir.

## Kapılar (son koşum durumu)

Bu belge yazılırken `type-check`, `lint`, `test`, `build` çalıştırılmadı — **doğrulanmadı**. Deploy öncesi `docs/DEPLOY.md` §1 kapıları koşulmalıdır.

## Son 7 günün özeti (2026-09-25 → 2026-10-02; git log, hepsi 2026-10-02 tarihli commit)

- **Arayüz:** menü 55 linkten 9 iş başlığına indi (sekme çubuğu + açılır alt sayfalar), canlı önbellek şeridi kaldırıldı; sidebar'da paket ve kullanım girişi.
- **Paket:** sayfa bazlı paket kilidi (26 sayfa), yükseltme sayfası, menüde kilit simgesi, paket metinleri gerçek kilitle uyumlu.
- **Veritabanı performansı:** RLS politikalarında pahalı fonksiyon çağrıları `(select ...)` ile sarıldı (InitPlan); 251 politikanın önceki hali için geri alma SQL'i belgelendi.
- **Hata düzeltmeleri:** PostgREST PGRST201 (113 gömülü sorguya FK adı; olmayan `authority_expires_at` sorgusu kaldırıldı); sabit/değişkenle verilen select metinlerinde belirsiz ilişkiler (listeler boş geliyordu).
- **Dışa aktarma:** 2000 satır kesilmesi kullanıcıya bildirilir, her dışa aktarma `audit_logs`'a yazılır.
- **Ürün dürüstlüğü:** ofis skorunun kural tabanlı olduğu açıkça belirtildi; kiralama KPI etiketi netleşti; demo seed'de yanıltıcı portal duyurusu düzeltildi; demo etkinlik yenileme script'i.
- **Release-hardening birleşti (PR #14):** production demo girişi için açık opt-in bayrakları, Next 16.3.8 + sharp 0.35.5, tasarım sistemi v3 temeli, pgcrypto `digest()` şema nitelemesi düzeltmeleri, core-workflow invariants migration'ı, Vercel production env kurulum script'i, CI/lint düzeltmeleri.

## Açık riskler (ayrıntı: `docs/ROADMAP.md`)

- Secret döndürme ve Git geçmişi temizliği açık (sahip sorumluluğu).
- Yedek/PITR doğrulaması ve restore provası açık.
- Canlı ledger ile depo arasında 1 migration fark olabilir (177 dosya vs bildirilen 176) — doğrulanmalı.
