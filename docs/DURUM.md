# EmlakSoft — Güncel Durum

**Tarih:** 2026-10-03 · **Dal:** main (HEAD 60446fe + sonraki commitler). Yol haritası: `docs/ROADMAP.md`.
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
| Migration dosyası | 179 | `supabase/migrations/*.sql`; son: `20260813000300_expense_text_appointment_loose_definitions_system.sql` (canlı DB'de uygulandı, ledger 179/179) |
| Canlıda uygulanmış migration | 176 (kullanıcı bildirimi — **doğrulanmadı**) | Kesin sonuç için `npm run check:migrations -- --database` |
| `route.ts` dosyası | 51 | `src/app/**/route.ts` |
| Cron route / `vercel.json` zamanlaması | 28 / 28 | `src/app/api/cron/*`, `vercel.json` |
| `page.tsx` | 160 (hepsi `src/app` altında) | `src/app/**/page.tsx` |
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

## 2026-10-02/03 turu (yol haritası v2)
**Canlıda:** 16 oluşturma popup'ı tam sayfa forma (`…/yeni`, ortak `FormShell/FormField/useCreateForm`) + 7 ekleme akışı sayfa içi panele; 5 detay sayfası URL'e bağlı sekmeler (`?sekme=`); Faz 2 birleşmeleri (Hesaplayıcılar, Kiralama+Kira artışı, Komisyon+Cüzdan+Onaylar, Ekip performansı); premium DataTable (opt-in); tema sistemi (token katmanı, 5 vurgu × açık/koyu, Görünüm paneli); tanım listeleri tek kaynak (`definition-defaults.ts`) + tanım ekranı (sıralama, renk, kullanım kontrolü, denetim) ve migration 000300 (`definitions.is_system`); rapor önbelleği yazma action'larına bağlı (`revalidate.ts`); tam dışa aktarma (`/api/export/<varlık>`, akışlı CSV); ofis sahibi ilk-gün deneyimi (kurulum şeridi, 'Başlayalım' kartı, ilk anlaşma adımı); Türkiye saati yardımcıları (`clock.ts` TR) ve randevu yazma yolunda +03:00; istemci paketi ~%27 küçüldü (supabase-js ve komut paleti lazy); nightly CI, webhook davranış testleri; güvenlik: palet son görülenler ofis+kullanıcı kapsamlı.
**Doğrulama (son tam tur):** tip temiz, 182 test dosyası / 1502 test, lint sıfır uyarı, check:links/cron/migrations, audit:actions/deps temiz, production build; canlıda Playwright denetimi (koyu hero kontrastı 15,76, #418 yok, TR gün tutarlı).
**Açık:** randevu formundan girilmiş ESKİ kayıtlar UTC yorumlanmış olabilir (3 saat kayma; veri düzeltmesi onay bekliyor); 14 sayfada eski koyu hero bandı (ajan çalışıyor); anlaşma aşamaları/özel alan/etiket tasarımı; mevzuat parametreleri (süper admin + ofis override) tasarımı; yedek/restore provası ve Güven Merkezi; kalan e-imza hukuki metni (`on-bilgilendirme`); `/app/musteriler` ağ ön yüklemeleri normal Next davranışı. Ayrıntı: `docs/YOL_HARITASI_V2.md`.

## Açık güvenlik borcu (kullanıcı kararıyla ertelendi, yayın öncesi ZORUNLU)
- **Platform TOTP kapalı:** `PLATFORM_MFA_ENFORCEMENT` ayarlı değil (varsayılan kapalı). Yayın öncesi Production env'e `PLATFORM_MFA_ENFORCEMENT=on` + redeploy. `/admin` üstündeki "Geliştirme modu" şeridi bunu hatırlatır.
- **Demo kartları canlıda açık** (`PRODUCTION_DEMO_LOGIN_OPT_IN`, `PRODUCTION_PLATFORM_DEMO_OPT_IN`): MFA kapalıyken giriş sayfasını açan herkes süper admin olabilir. Yayın öncesi ikisini de kapat.
- Sızan anahtarların döndürülmesi ve Git geçmişi temizliği.
