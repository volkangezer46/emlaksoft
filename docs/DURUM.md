# EmlakSoft — Güncel Durum

**Tarih:** 2026-10-05 · **Dal:** main (`origin/main` = canlı, `c5a6d32f`). Yol haritası: `docs/ROADMAP.md`.
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
| Migration dosyası | 243 | `supabase/migrations/*.sql` (main'de 242; 001000 yeni eklendi, diğer ajanların 000900/001100 dosyaları kendi dallarında); son uygulanan: `20260826000800_default_program_settings.sql`; yeni uygulanmamış: 000900, 001000, 001100 (`docs/runbooks/YAYIN_PENCERESI_2.md` §8) |
| Canlıda uygulanmış migration | `20260826000800`a kadar HEPSİ (2026-10-05) | `check:migrations -- --database` salt-okunur; bekleyen yok, yukarıdaki 3 yeni dosya hariç |
| `route.ts` dosyası | 70 | `src/app/**/route.ts` |
| Cron route / `vercel.json` zamanlaması | 35 / 35 | `src/app/api/cron/*`, `vercel.json` (31. cron: `ef-kontor-hak`, günlük 01:10 UTC = 04:10 TR, aylık EmlakFiyati kontör hakkı + hoş geldin kontörü; cüzdan hazır değilse atlar; 32. cron: `growth-claims`, günlük 03:40 UTC = 06:40 TR, referans/ortak ödül işleyicisi, cüzdan hazır değilse ödül yüklemez; 33. cron: `ef-kontor-sweep`, 10 dakikada bir, 15 dakikadan eski açık EF kontör rezervlerini `ef_credit_sweep` ile serbest bırakır); 34. cron: `ef-kontor-saglik`, günlük 01:50 UTC = 04:50 TR, EmlakFiyati ortak probe'u ile `emlakfiyati_ortak_probe_ok_at` damgasını yeniler/siler); 35. cron: `ef-kontor-mutabakat`, günlük 02:10 UTC = 05:10 TR, EmlakFiyati kullanım ile kontör defterini mutabık eder, sonuç `ef_reconciliation_runs`; sayı `npm run check:cron` ile doğrulanır |
| `page.tsx` | 229 (hepsi `src/app` altında) | `src/app/**/page.tsx` |
| Test dosyası | 368 | `src/**/*.test.ts(x)` (Playwright `e2e/*.spec.ts` hariç) |
| Test (case) sayısı | **doğrulanmadı** | `npm run test` çıktısından alınmalı |

Not: eski belgelerdeki "113 rota, 170 birim + 28 E2E test, 15 cron" gibi sayılar tarihseldir.

## Kapılar (son koşum durumu)

Dalga 1 tutarlılık paketi dalında (2026-10-04) koşulan: `tsc --noEmit` temiz; dokunulan dosyalarda `eslint` temiz; `vitest run` 273 dosya / 2824 test yeşil; `check:links` ve `audit:actions` temiz; `next build` (preview ortam değişkenleriyle) başarılı. Bu sonuçlar o dal içindir; main'e birleşimden sonra ve deploy öncesi `docs/DEPLOY.md` §1 kapıları yeniden koşulmalıdır. `check:migrations -- --database` ve canlı doğrulama bu turda koşulmadı.

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
- Canlı ledger ile depo: 2026-10-05 itibarıyla `20260826000800`a kadar eşit; yeni dosyalar uygulanana dek `check:migrations -- --database` bunları "bekleyen" gösterir (beklenen).
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

## Varsayılan program seed (2026-10-05) — UYGULANDI
- `20260826000800_default_program_settings.sql` canlıda UYGULANDI (referans programı açık, hoş geldin 300 TL, katalog kaydı, EF paketleri). Ayrıntı: `docs/HAFIZA.md` §11. Release çifti DB`deki son migration`a çekilmelidir (DEPLOY.md). Bu dosyadaki sayılar 2026-10-05 dosya sisteminden sayılmıştır; test (case) sayısı doğrulanmadı.
- **Büyüme hotfix'i (PB14):** `20260826000900_growth_hotfix.sql` hazır, canlı DB'ye UYGULAMA BEKLİYOR (referans programı AÇIK olduğundan öncelikli: ilk-N sayacı, bekleme/yenileme kapısı, hoş geldin kredisi ilk ödemede, chargeback, panel gizliliği). Komut: `npm run db:migrate -- --only 20260826000900_growth_hotfix.sql` (önce backup/PITR). Ayrıntı: `docs/HAFIZA.md` §12. DOĞRULANMADI.
