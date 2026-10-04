# EmlakSoft — Güncel Durum

**Tarih:** 2026-10-04 · **Dal:** main (K2, K5, SEO, Modüller kapıları birleşmiş; üstüne Dalga 1 tutarlılık paketi). Yol haritası: `docs/ROADMAP.md`.
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
| Migration dosyası | 206 | `supabase/migrations/*.sql`; son: `20260819010600_k5_kvkk_requests.sql`. Bu turun K2/K5 migration'larının (kupon, hesap/abonelik/şube, KVKK talepleri) canlıya uygulanıp uygulanmadığı **doğrulanmadı** |
| Canlıda uygulanmış migration | **doğrulanmadı** | Kesin sonuç için `npm run check:migrations -- --database` (salt-okunur); uygulama yalnız yedek/PITR doğrulandıktan sonra `npm run db:migrate` |
| `route.ts` dosyası | 59 | `src/app/**/route.ts` |
| Cron route / `vercel.json` zamanlaması | 28 / 28 | `src/app/api/cron/*`, `vercel.json` (28. cron: `seo-robot`, günlük 04:20); sayı `npm run check:cron` ile doğrulanır |
| `page.tsx` | 194 (hepsi `src/app` altında) | `src/app/**/page.tsx` |
| Test dosyası | 272 | `src/**/*.test.ts(x)` (Playwright `e2e/*.spec.ts` hariç) |
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
- Canlı ledger ile depo arasındaki fark **doğrulanmadı** (depoda 206 dosya; son turların migration'ları canlıda olmayabilir) — `npm run check:migrations -- --database` ile bakılmalı.
- `tenant_reporting_aggregates` RPC'si (`/app/raporlar`) ve `tenant_commission_aggregates` (ana ekran komisyon özeti) `is_sample` süzmez: eşik dışlaması bu iki toplulaştırmaya SQL değişikliği olmadan uygulanamaz. Örnek veri yüklüyse etiketlenir ("Örnek veri dahil"); süzgeç için yeni migration gerekir (sahip kararı).

## 2026-10-02/03 turu (yol haritası v2)
**Canlıda:** 16 oluşturma popup'ı tam sayfa forma (`…/yeni`, ortak `FormShell/FormField/useCreateForm`) + 7 ekleme akışı sayfa içi panele; 5 detay sayfası URL'e bağlı sekmeler (`?sekme=`); Faz 2 birleşmeleri (Hesaplayıcılar, Kiralama+Kira artışı, Komisyon+Cüzdan+Onaylar, Ekip performansı); premium DataTable (opt-in); tema sistemi (token katmanı, 5 vurgu × açık/koyu, Görünüm paneli); tanım listeleri tek kaynak (`definition-defaults.ts`) + tanım ekranı (sıralama, renk, kullanım kontrolü, denetim) ve migration 000300 (`definitions.is_system`); rapor önbelleği yazma action'larına bağlı (`revalidate.ts`); tam dışa aktarma (`/api/export/<varlık>`, akışlı CSV); ofis sahibi ilk-gün deneyimi (kurulum şeridi, 'Başlayalım' kartı, ilk anlaşma adımı); Türkiye saati yardımcıları (`clock.ts` TR) ve randevu yazma yolunda +03:00; istemci paketi ~%27 küçüldü (supabase-js ve komut paleti lazy); nightly CI, webhook davranış testleri; güvenlik: palet son görülenler ofis+kullanıcı kapsamlı.
**Doğrulama (son tam tur):** tip temiz, 182 test dosyası / 1502 test, lint sıfır uyarı, check:links/cron/migrations, audit:actions/deps temiz, production build; canlıda Playwright denetimi (koyu hero kontrastı 15,76, #418 yok, TR gün tutarlı).
**Açık:** randevu formundan girilmiş ESKİ kayıtlar UTC yorumlanmış olabilir (3 saat kayma; veri düzeltmesi onay bekliyor); 14 sayfada eski koyu hero bandı (ajan çalışıyor); anlaşma aşamaları/özel alan/etiket tasarımı; mevzuat parametreleri (süper admin + ofis override) tasarımı; yedek/restore provası ve Güven Merkezi; kalan e-imza hukuki metni (`on-bilgilendirme`); `/app/musteriler` ağ ön yüklemeleri normal Next davranışı. Ayrıntı: `docs/YOL_HARITASI_V2.md`.

## 2026-10-03/04 turu (Birleşik yol haritası, paralel paketler + Dalga 1 tutarlılık)

**Birleşmiş ve kodda olan (kanıt dosyası):**
- **Modül sistemi:** ofis bazlı modül aç/kapat. Kayıt defteri `src/lib/modules/registry.ts` (34 ürün modülü anahtarı, çekirdek alanlar kapatılamaz), durum/mantık `logic.ts`, kapı `guard.ts` + server action kapısı (`actionBlockedByModule`), kapatırken bekleyen iş uyarısı (`pending.ts`), ekran `/app/ayarlar/moduller`, kapalı modül sayfası `/app/modul-kapali`; 6 cron kapalı modülü atlar, public yüzeyler "kapalı" sayfası gösterir. Satır yoksa modül AÇIK.
- **SEO merkezi:** `/admin/seo`, `src/lib/seo/*`, dinamik sitemap/robots, yönlendirme (`[...slug]`), JSON-LD, günlük denetim robotu (`seo-robot` cron, 28. cron), IndexNow varsayılan kapalı. Ayrıntı: `docs/MIMARI.md` "SEO sistemi".
- **Plan okuyucu:** `src/lib/billing/plan-definitions.ts` (`getPlanDefinitions`, `quotePlan`, `getFoundersStatus` …); `plans.ts` varsayılan kaynak, panel düzenlemesi `plan-overrides.ts` ile üstüne biner; kupon (`coupon*.ts`), mutabakat (`billing-reconciliation` cron). Paket kilidi `page-gates.ts`.
- **K5 hesap/abonelik/ekip/şube/uyum:** `/app/abonelik`, `/app/ekip/subeler`, `/app/uyum` (KVKK talepleri, İYS, denetim dosyası), `/app/askida` (askıya alınmış hesap).
- **Bakım modu:** platform bayrağı `maintenanceMode` + ileti (`src/lib/platform-flags.ts`, `platform-flags-cache.ts`, 30 sn önbellek), `src/proxy.ts` public sayfalarda okur; okunamazsa güvenli varsayılan KAPALI.
- **TV modu:** `/app/pano-tv` (kabuksuz, tam ekran, canlı), veri `src/lib/tv/tv-data.ts` (`/api/app/tv-data`), gizlilik sözleşmesi `tv-privacy-contract.test.ts`; ana ekrandaki `?tv=1` eski bağlantıları buraya yönlenir.
- **Telefon tek merkez:** `src/lib/phone-rules.ts` (libphonenumber-js/min, sabit sürüm) + `PhoneInput`; sunucuda `parsePhoneStrict`/`phoneSchema`. Kural ve kontrol listesi `CLAUDE.md`'dedir; sözleşme testi `contact-input-contract.test.ts`.

**Dalga 1 tutarlılık paketi (bu tur):**
- **Örnek veri KPI eşiği tek yardımcıda:** `lib/sample-scope.ts` (`loadSampleKpiScope`, `buildSampleKpiScope`, `SAMPLE_DATA_LABEL`). Gerçek müşteri VEYA portföy sayısı `SAMPLE_KPI_THRESHOLD` (5) altındaysa örnek kayıtlar rakamlara girer ve "Örnek veri dahil" etiketi çıkar; eşik aşılınca `is_sample=false` süzgeci otomatik uygulanır. Uygulanan yüzeyler: lig, ana ekran (`_home/data.ts`: `ctx.sample`), danışman metrikleri (`team/advisor-metrics.ts`; danışman KPI, kıyas, Performansım, hedefler), pano-tv, ofis skoru (`office-score.ts`), raporlar (yalnız etiket; yukarıdaki RPC sınırı). Sözleşme: `sample-kpi-scope.test.ts`.
- **Ay sınırları Türkiye takvimine göre:** `clock.ts` `trMonthStartMs/Iso`, `trMonthKey`, `shiftMonthKey`, `trMonthStartMsFromKey`; çevrilen yerler: lig dönemi (`gamification-query.ts`, ay gezinme), kayıp-kaçak "bu ay", onaylar "bu ay", hedefler dönem ilerlemesi + varsayılan ay, kira tahakkuk ay seçici. Test: `clock-tr.test.ts`.
- **Rol etiketi tek kaynak:** `lib/role-labels.ts` (`ROLE_LABELS`); 8 yerel kopya kaldırıldı, sözleşme `role-labels-contract.test.ts`.
- **Terim sözlüğü:** `lib/terminology.ts` + `terminology-contract.test.ts` (kullanıcıya görünen metinde "lead", "cüzdan", "kişisel hakediş" yasak; musteriler paketindeki 4 "Lead skoru" metni sahibinin birleşimine bırakıldı). "Kayıp" üç kavram olarak ayrıldı: **Kaçan komisyon** (kayıp-kaçak kalkanı, `/app/kayip-kacak`), **Kaybedilen anlaşma / kayıp nedeni** (anlaşma kapanışı, raporlar), **Risk altındaki müşteriler** (`/app/kayip-satis`, eski "Kayıp nedenleri" adı).

**Doğrulama:** bu turun kapı sonuçları aşağıdaki "Kapılar" bölümündedir.

## Açık güvenlik borcu (kullanıcı kararıyla ertelendi, yayın öncesi ZORUNLU)
- **Platform TOTP kapalı:** `PLATFORM_MFA_ENFORCEMENT` ayarlı değil (varsayılan kapalı). Yayın öncesi Production env'e `PLATFORM_MFA_ENFORCEMENT=on` + redeploy. `/admin` üstündeki "Geliştirme modu" şeridi bunu hatırlatır.
- **Demo kartları canlıda açık** (`PRODUCTION_DEMO_LOGIN_OPT_IN`, `PRODUCTION_PLATFORM_DEMO_OPT_IN`): MFA kapalıyken giriş sayfasını açan herkes süper admin olabilir. Yayın öncesi ikisini de kapat.
- Sızan anahtarların döndürülmesi ve Git geçmişi temizliği.
