# EmlakSoft — Güncel Durum

**Tarih:** 2026-10-14 · **Dal:** main (`92354e17` tabanı). **Canlı:** https://emlaksoft.com.tr — Hetzner `emlaksoft-prod`
(bu sunucu; self-hosted Supabase aynı makinede, Coolify Traefik). Eski Vercel + bulut Supabase dondurulmuştur, iş oraya gitmez.
**Yayın akışı:** `bash scripts/sunucu/release.sh` → `scripts/gate/fast.sh` (tsc + lint + tam vitest, check:links/cron/migrations,
audit:actions) → `npm run db:migrate` → `.env.production` sürüm işareti → `scripts/sunucu/deploy.sh` (Docker build + sağlık) → `git push`.
Yol haritası: `docs/ROADMAP.md`. Sayılar bu tarihte dosya sisteminden/`package.json`'dan sayılmıştır; eskirler, komutla yeniden sayın.

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
| Migration dosyası | 418 | `supabase/migrations/*.sql`; `npm run check:migrations` → "418 dosya · son `20261014009000_cl_app_canonical_links.sql` · sha256 `b2f6f1bf72c060f4`"; geri alma dosyaları `supabase/rollbacks/` (237) |
| Canlıda uygulanmış migration | 418 / 418 (2026-10-14) | `public.schema_migrations` salt-okunur sayım; son kayıt `20261014009000_cl_app_canonical_links.sql`; bekleyen yok |
| `route.ts` dosyası | 110 | `src/app/**/route.ts` |
| Ürün modülü (ofis aç/kapat) | 29 (7 paket) | `src/lib/modules/registry.ts` `MODULES` / `BUNDLES` |
| Cron route / `vercel.json` zamanlaması | 40 / 40 | `src/app/api/cron/*`, `vercel.json` (31. cron: `ef-kontor-hak`, günlük 01:10 UTC = 04:10 TR, aylık EmlakFiyati kontör hakkı + hoş geldin kontörü; cüzdan hazır değilse atlar; 32. cron: `growth-claims`, günlük 03:40 UTC = 06:40 TR, referans/ortak ödül işleyicisi, cüzdan hazır değilse ödül yüklemez; 33. cron: `ef-kontor-sweep`, 10 dakikada bir, 15 dakikadan eski açık EF kontör rezervlerini `ef_credit_sweep` ile serbest bırakır); 34. cron: `ef-kontor-saglik`, günlük 01:50 UTC = 04:50 TR, EmlakFiyati ortak probe'u ile `emlakfiyati_ortak_probe_ok_at` damgasını yeniler/siler); 35. cron: `ef-kontor-mutabakat`, günlük 02:10 UTC = 05:10 TR, EmlakFiyati kullanım ile kontör defterini mutabık eder, sonuç `ef_reconciliation_runs`; 36. cron: `insight-engine`, 30 dakikada bir (:12/:42), ofis başına kural tabanlı içgörü üretir (`insights`), migration yoksa "etkin değil" kaydı düşer; 37. cron: `yayin-zamanlayici`, 5 dakikada bir, yayın masasında zamanlanan site menüsü/içeriği taslaklarını yayınlar ve bitişte önceki sürüme döndürür (`publishing.scheduled`); 38. cron: `olcum-bakim`, günlük 02:40 UTC = 05:40 TR, ölçüm tamponunu boşaltır ve eski sayaçları budar (`analytics_prune`: sayfa 400 gün, hız 90 gün); 39. cron: `hiz-robotu`, günlük 02:55 UTC = 05:55 TR, statik sunumu açık sayfalar ile `/` ve `/fiyatlar` için PageSpeed mobil+masaüstü ölçümü (`perf_lab_runs`), anahtar yoksa "atlandı"; 40. cron: `google-senkron`, günlük 03:10 UTC = 06:10 TR, Search Console/URL denetimi/Google Ads (yalnız okuma) senkronu, bağlantı yoksa dış çağrı yapmadan atlar; sayı `npm run check:cron` ile doğrulanır ("Cron kontratı sağlıklı: 40 rota"); sunucuda `/etc/cron.d/emlaksoft` 40 satır (`scripts/sunucu/install-cron.sh`) |
| `page.tsx` | 280 (hepsi `src/app` altında) | `src/app/**/page.tsx` |
| Test dosyası | 906 | `src/**/*.test.ts(x)` (Playwright `e2e/*.spec.ts` hariç) |
| Test (case) sayısı | **doğrulanmadı** | `npm run test` çıktısından alınmalı |

Not: eski belgelerdeki "113 rota, 170 birim + 28 E2E test, 15 cron" gibi sayılar tarihseldir.

## Kapılar (son koşum durumu)

Her yayında `scripts/gate/fast.sh` koşar (sonuç `/tmp/emlaksoft-gate/fast.log`, son satır `GATE_OK`); başarısızsa `release.sh` durur.
GP4 paketinde (2026-10-14, worktree): `tsc --noEmit` temiz, dokunulan dosyalarda `eslint` temiz, ilgili vitest dosyaları yeşil,
`check:cron` 40 rota, `check:migrations` 418 dosya. Tam takım birleştirmeden sonra koşulur.

## 2026-10-13/14 turu (özet; ayrıntı `docs/HAFIZA.md` başı)

- **Altyapı:** üretim Hetzner'e taşındı (Docker + Coolify, self-hosted Supabase); cron'lar `/etc/cron.d/emlaksoft` üzerinden; yedek/geri yükleme betikleri `scripts/sunucu/{backup-db,restore-drill,restore-list}.*`; hata/uyarı izleme `error-watch.sh`, `alert-send.py`.
- **Admin 2. dalga (AD1–AD12, DG1–DG8):** abonelik konsolu (askıya alma/iptal doğrulayıcı kodla), e-posta şablon merkezi (`/admin/ayarlar/eposta`), personel özel rolleri + dört göz (`/admin/personel/roller`, `/admin/personel/guvenlik`), KVKK talep akışı (`/admin/tickets/kvkk`), bayrak hedefleme (`/admin/ayarlar/bayraklar`), NPS (`/admin/duyuru?sekme=nps`), öneri panosu (`/admin/tickets/oneriler`), sistem sekmeleri (sağlık, entegrasyonlar, hata kayıtları, uyarılar, durum sayfası, kaynaklar, veritabanı), site/SEO/reklam/hız merkezi (`/admin/site/*`), faturalama alt ekranları (planlar, kuponlar, tahsilat, muhasebe, fatura defteri, kanal ROI). Menü ve sekmeler tek kaynak `src/lib/admin/nav.ts`.
- **Finans mini muhasebe (FN1–FN6):** Hareketler defteri v2 (`finance_ledger_v`), KDV/stopaj (Vergi sekmesi), cari, dönem kilidi, düzenli kurallar. GP4: Hareketler'e `kdv=yok` ve `kaynak=elle` süzgeçleri; Vergi ve Kâr/zarar sayıları süzgeçli listeye iner.
- **EİDS / portal üyeliği (EP1–EP5)** ve **sahibinden ilanlar (FSBO)**.
- **Temizlik (CL-APP, CL-ADMIN):** mükerrer sayfalar ve eski yol takma adları kalıntısız silindi (sahip kuralı: yönlendirme yok); kayıtlı bağlantılar `20261014009000_cl_app_canonical_links` ile kanonik yola çekildi.
- **Derin bağlantılar (GP4):** `/app/gorevler?gorev=<id>`, `/app/randevular?randevu=<id>`; bildirimler kaydın kendisini açar.

## Geçmiş turlar (tarihsel; sayılar o günün)

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
- Canlı ledger ile depo: 2026-10-14 itibarıyla 418 / 418 eşit (son `20261014009000`); yeni dosya `release.sh` içindeki `db:migrate` ile uygulanana dek `check:migrations -- --database` onu "bekleyen" gösterir (beklenen).
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
- **Eski yol takma adları KALDIRILDI (2026-10-13, sahip kuralı: iz bırakılmaz):** `next.config.ts` yönlendirmeleri `/app/brifing`, `/app/ekip/kazanc`, `/app/ayarlar/duyurular`, `/app/arama`, `/app/eslestirme`, `/app/yatirim`, `/admin/ef-kontor`, `/admin/satis` silindi (yalnız public `/demo → /kayit` kalır); yalnız yönlendiren sayfalar `/app/kayip-satis`, `/app/ekip/kiyas`, `/admin/ayarlar` (kök) ve `/app/projeler?yeni`, `/app/acik-ev?yeni=1` sorgu takma adları silindi; bağlantılar doğrudan hedefe gider (`/app/musteriler?segment=risk`, `/app/danisman-kpi?gorunum=kiyas`, `/admin/ayarlar/merkez`). Eski yol klasörlerindeki bileşenler hedef sayfa klasörüne taşındı (`gelen-kutusu/`, `talepler/`, `hesaplayici/`, `bildirimler/`, `danisman-kpi/`); `NAV_ALIASES` ve `merged-pages-contract.test.ts` kaldırıldı.
- **TV modu:** `/app/pano-tv` (kabuksuz, tam ekran, canlı), veri `src/lib/tv/tv-data.ts` (`/api/app/tv-data`), gizlilik sözleşmesi `tv-privacy-contract.test.ts`; ana ekrandaki `?tv=1` eski bağlantıları buraya yönlenir.
- **Telefon tek merkez:** `src/lib/phone-rules.ts` (libphonenumber-js/min, sabit sürüm) + `PhoneInput`; sunucuda `parsePhoneStrict`/`phoneSchema`. Kural ve kontrol listesi `CLAUDE.md`'dedir; sözleşme testi `contact-input-contract.test.ts`.

**Dalga 1 tutarlılık paketi (bu tur):**
- **Örnek veri KPI eşiği tek yardımcıda:** `lib/sample-scope.ts` (`loadSampleKpiScope`, `buildSampleKpiScope`, `SAMPLE_DATA_LABEL`). Gerçek müşteri VEYA portföy sayısı `SAMPLE_KPI_THRESHOLD` (5) altındaysa örnek kayıtlar rakamlara girer ve "Örnek veri dahil" etiketi çıkar; eşik aşılınca `is_sample=false` süzgeci otomatik uygulanır. Uygulanan yüzeyler: lig, ana ekran (`_home/data.ts`: `ctx.sample`), danışman metrikleri (`team/advisor-metrics.ts`; danışman KPI, kıyas, Performansım, hedefler), pano-tv, ofis skoru (`office-score.ts`), raporlar (yalnız etiket; yukarıdaki RPC sınırı). Sözleşme: `sample-kpi-scope.test.ts`.
- **Ay sınırları Türkiye takvimine göre:** `clock.ts` `trMonthStartMs/Iso`, `trMonthKey`, `shiftMonthKey`, `trMonthStartMsFromKey`; çevrilen yerler: lig dönemi (`gamification-query.ts`, ay gezinme), kayıp-kaçak "bu ay", onaylar "bu ay", hedefler dönem ilerlemesi + varsayılan ay, kira tahakkuk ay seçici. Test: `clock-tr.test.ts`.
- **Rol etiketi tek kaynak:** `lib/role-labels.ts` (`ROLE_LABELS`); 8 yerel kopya kaldırıldı, sözleşme `role-labels-contract.test.ts`.
- **Terim sözlüğü:** `lib/terminology.ts` + `terminology-contract.test.ts` (kullanıcıya görünen metinde "lead", "cüzdan", "kişisel hakediş" yasak; musteriler paketindeki 4 "Lead skoru" metni sahibinin birleşimine bırakıldı). "Kayıp" üç kavram olarak ayrıldı: **Kaçan komisyon** (kayıp-kaçak kalkanı, `/app/ilan-kontrol/kapanis`), **Kaybedilen anlaşma / kayıp nedeni** (anlaşma kapanışı, raporlar), **Risk altındaki müşteriler** (Akıllı listeler `?segment=churn` bölümü; eski ayrı sayfa silindi).

**Doğrulama:** bu turun kapı sonuçları aşağıdaki "Kapılar" bölümündedir.

## Açık güvenlik borcu (kullanıcı kararıyla ertelendi, yayın öncesi ZORUNLU)
- **Platform TOTP kapalı:** `PLATFORM_MFA_ENFORCEMENT` ayarlı değil (varsayılan kapalı). Yayın öncesi Production env'e `PLATFORM_MFA_ENFORCEMENT=on` + redeploy. `/admin` üstündeki "Geliştirme modu" şeridi bunu hatırlatır.
- **Demo kartları canlıda açık** (`PRODUCTION_DEMO_LOGIN_OPT_IN`, `PRODUCTION_PLATFORM_DEMO_OPT_IN`): MFA kapalıyken giriş sayfasını açan herkes süper admin olabilir. Yayın öncesi ikisini de kapat.
- Sızan anahtarların döndürülmesi ve Git geçmişi temizliği.

## Varsayılan program seed (2026-10-05) — UYGULANDI
- `20260826000800_default_program_settings.sql` canlıda UYGULANDI (referans programı açık, hoş geldin 300 TL, katalog kaydı, EF paketleri). Ayrıntı: `docs/HAFIZA.md` §11. Release çifti DB`deki son migration`a çekilmelidir (DEPLOY.md). Bu dosyadaki sayılar 2026-10-05 dosya sisteminden sayılmıştır; test (case) sayısı doğrulanmadı.
- **Büyüme hotfix'i (PB14):** `20260826000900_growth_hotfix.sql` hazır, canlı DB'ye UYGULAMA BEKLİYOR (referans programı AÇIK olduğundan öncelikli: ilk-N sayacı, bekleme/yenileme kapısı, hoş geldin kredisi ilk ödemede, chargeback, panel gizliliği). Komut: `npm run db:migrate -- --only 20260826000900_growth_hotfix.sql` (önce backup/PITR). Ayrıntı: `docs/HAFIZA.md` §12. DOĞRULANMADI.
